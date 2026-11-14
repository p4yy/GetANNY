# HTTP transfer integrity

Multipart downloads require an advertised byte-range response and either a strong ETag or a SHA-256 checksum for the whole representation. A range response must match its requested bounds and total length. The engine uses If-Range with a strong ETag and checks the returned representation before writing bytes. A whole-representation checksum is verified before publication when one is available.

Each job keeps its partial files and a versioned checkpoint in its work directory. The engine flushes each active part after up to 4 MiB or approximately one second of writes, and flushes its final prefix when the stream settles. The checkpoint advances only after the part is synced. A restart truncates bytes beyond the last committed offset and also accounts for a shorter file on disk. Pre-checkpoint partials restart from zero because their physical lengths alone cannot establish a durable prefix.

The final file is linked into the destination without replacing any existing directory entry. When the work directory is on another volume, the engine syncs a staged copy in the destination before linking it. A destination filesystem that cannot provide this link operation reports an error and keeps the resumable work.

Regression coverage in `tests/transfer-integrity.test.js` includes response identity changes, validator-free servers, checksum mismatches, destination collisions, unexpected HTML, pause and recovery with 64 concurrent ranges, and bytes written beyond the last committed checkpoint.
