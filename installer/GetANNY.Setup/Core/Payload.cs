using System.Buffers.Binary;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace GetANNY.Setup.Core;

/// <summary>
/// Reads the NSIS engine appended to this executable by scripts/windows/wrap-installer.js.
///
/// Overlay layout (appended after the published single-file EXE):
///   [ engine bytes ]
///   [ trailer: 64 bytes ]
///       32  SHA-256 of engine bytes
///        8  engine length            (little-endian uint64)
///        8  reserved (zero)
///       16  magic  "GETANNY-NSIS-V1\0"
///
/// When the bootstrapper is Authenticode-signed *after* wrapping, signtool appends
/// the certificate table behind the overlay, so the trailer is located relative to
/// the PE security directory instead of the physical end of file.
/// </summary>
public sealed class Payload
{
    public const int TrailerLength = 64;
    public static readonly byte[] Magic = Encoding.ASCII.GetBytes("GETANNY-NSIS-V1\0");

    public string SourcePath { get; }
    public long EngineOffset { get; }
    public long EngineLength { get; }
    public byte[] Sha256 { get; }

    private Payload(string source, long offset, long length, byte[] sha)
    {
        SourcePath = source; EngineOffset = offset; EngineLength = length; Sha256 = sha;
    }

    public static Payload? TryOpen(string exePath)
    {
        try
        {
            using var fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            var logicalEnd = PeLogicalEnd(fs);
            if (logicalEnd < TrailerLength) return null;

            Span<byte> trailer = stackalloc byte[TrailerLength];
            fs.Position = logicalEnd - TrailerLength;
            fs.ReadExactly(trailer);
            if (!trailer[48..].SequenceEqual(Magic)) return null;

            var length = (long)BinaryPrimitives.ReadUInt64LittleEndian(trailer[32..40]);
            var offset = logicalEnd - TrailerLength - length;
            if (length <= 0 || offset < 0) return null;
            return new Payload(exePath, offset, length, trailer[..32].ToArray());
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    /// <summary>Extracts the engine to <paramref name="destination"/> while verifying its SHA-256.</summary>
    public async Task ExtractAsync(string destination, IProgress<double>? progress, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        using var src = new FileStream(SourcePath, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 1 << 16, true);
        await using var dst = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true);
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

        src.Position = EngineOffset;
        var buffer = new byte[1 << 20];
        long remaining = EngineLength, done = 0;
        while (remaining > 0)
        {
            var n = await src.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), ct);
            if (n <= 0) throw new EndOfStreamException("Setup payload is truncated.");
            sha.AppendData(buffer, 0, n);
            await dst.WriteAsync(buffer.AsMemory(0, n), ct);
            remaining -= n; done += n;
            progress?.Report((double)done / EngineLength);
        }
        await dst.FlushAsync(ct);
        if (!sha.GetHashAndReset().AsSpan().SequenceEqual(Sha256))
        {
            dst.Close();
            File.Delete(destination);
            throw new InvalidDataException("Setup payload failed integrity verification (SHA-256 mismatch). The download may be corrupted.");
        }
    }

    /// <summary>
    /// Returns the offset of the Authenticode certificate table if present, else the file length.
    /// Everything after that offset belongs to the signature, not to the overlay.
    /// </summary>
    private static long PeLogicalEnd(FileStream fs)
    {
        try
        {
            Span<byte> b = stackalloc byte[4];
            fs.Position = 0x3C; fs.ReadExactly(b);
            var peOffset = BinaryPrimitives.ReadInt32LittleEndian(b);
            fs.Position = peOffset; fs.ReadExactly(b);
            if (b[0] != 'P' || b[1] != 'E') return fs.Length;

            Span<byte> opt = stackalloc byte[2];
            fs.Position = peOffset + 24; fs.ReadExactly(opt);
            var magic = BinaryPrimitives.ReadUInt16LittleEndian(opt);
            var dataDirOffset = magic == 0x20B ? peOffset + 24 + 112 : peOffset + 24 + 96;
            fs.Position = dataDirOffset + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
            Span<byte> dir = stackalloc byte[8];
            fs.ReadExactly(dir);
            var certOffset = BinaryPrimitives.ReadUInt32LittleEndian(dir[..4]);
            var certSize = BinaryPrimitives.ReadUInt32LittleEndian(dir[4..]);
            return certOffset > 0 && certSize > 0 && certOffset <= fs.Length ? certOffset : fs.Length;
        }
        catch (IOException) { return fs.Length; }
    }
}
