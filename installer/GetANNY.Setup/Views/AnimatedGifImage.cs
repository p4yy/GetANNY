using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using GetANNY.Setup.Core;

namespace GetANNY.Setup.Views;

/// <summary>
/// Plays a WPF GIF resource by compositing each image descriptor onto its logical
/// screen. GifBitmapDecoder exposes partial frame rectangles, so assigning its
/// frames directly to Image.Source would lose the previous frame content.
/// </summary>
public sealed class AnimatedGifImage : Image
{
    public static readonly DependencyProperty ResourceUriProperty = DependencyProperty.Register(
        nameof(ResourceUri), typeof(Uri), typeof(AnimatedGifImage), new PropertyMetadata(null, OnResourceUriChanged));

    private readonly DispatcherTimer _timer;
    private readonly List<Frame> _frames = [];
    private WriteableBitmap? _bitmap;
    private byte[]? _canvas;
    private byte[]? _restoreCanvas;
    private Frame? _previous;
    private Window? _window;
    private int _nextFrame;
    private int _extraLoops;
    private int _playsCompleted;
    private bool _hasLoopExtension;
    private bool _loaded;
    private bool _windowActive = true;
    private bool _windowMinimized;
    private Color _backgroundColor = Color.FromRgb(14, 14, 14);

    public AnimatedGifImage()
    {
        Stretch = Stretch.Uniform;
        SnapsToDevicePixels = true;
        _timer = new DispatcherTimer(DispatcherPriority.Render, Dispatcher);
        _timer.Tick += OnFrameTick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        IsVisibleChanged += OnVisibilityChanged;
    }

    public Uri? ResourceUri
    {
        get => (Uri?)GetValue(ResourceUriProperty);
        set => SetValue(ResourceUriProperty, value);
    }

    private static void OnResourceUriChanged(DependencyObject owner, DependencyPropertyChangedEventArgs args)
    {
        var player = (AnimatedGifImage)owner;
        if (player._loaded) player.LoadAndPlay();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _loaded = true;
        AttachWindow();
        LoadAndPlay();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _loaded = false;
        _timer.Stop();
        DetachWindow();
        ReleaseAnimation();
    }

    private void OnVisibilityChanged(object sender, DependencyPropertyChangedEventArgs e) => UpdatePlayback();

    private void AttachWindow()
    {
        _window = Window.GetWindow(this);
        if (_window is null) return;
        _window.Activated += OnWindowActivated;
        _window.Deactivated += OnWindowDeactivated;
        _window.StateChanged += OnWindowStateChanged;
        _windowActive = _window.IsActive;
        _windowMinimized = _window.WindowState == WindowState.Minimized;
    }

    private void DetachWindow()
    {
        if (_window is not null)
        {
            _window.Activated -= OnWindowActivated;
            _window.Deactivated -= OnWindowDeactivated;
            _window.StateChanged -= OnWindowStateChanged;
            _window = null;
        }
        _windowActive = true;
        _windowMinimized = false;
    }

    private void OnWindowActivated(object? sender, EventArgs e) { _windowActive = true; UpdatePlayback(); }
    private void OnWindowDeactivated(object? sender, EventArgs e) { _windowActive = false; UpdatePlayback(); }
    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        _windowMinimized = _window?.WindowState == WindowState.Minimized;
        UpdatePlayback();
    }

    private void LoadAndPlay()
    {
        _timer.Stop();
        ReleaseAnimation();
        if (ResourceUri is null || !_loaded) return;

        try
        {
            var resource = Application.GetResourceStream(ResourceUri)
                ?? throw new FileNotFoundException("The embedded GetANNY logo animation was not found.", ResourceUri.ToString());
            using var stream = resource.Stream;
            var decoder = new GifBitmapDecoder(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
            if (decoder.Frames.Count == 0) throw new InvalidDataException("The embedded GetANNY logo animation has no frames.");

            var width = decoder.Frames[0].PixelWidth;
            var height = decoder.Frames[0].PixelHeight;
            if (width <= 0 || height <= 0) throw new InvalidDataException("The GetANNY logo animation has an invalid canvas size.");
            _backgroundColor = TryFindResource("Color.Background") is Color themeBackground
                ? themeBackground
                : Color.FromRgb(14, 14, 14);
            _bitmap = new WriteableBitmap(width, height, 96, 96, PixelFormats.Bgra32, null);
            _canvas = new byte[checked(width * height * 4)];
            FillBackground(_canvas, 0, 0, width, height, width, height, _backgroundColor);

            foreach (var source in decoder.Frames)
            {
                var metadata = source.Metadata as BitmapMetadata;
                var left = MetadataInt(metadata, "/imgdesc/Left", 0);
                var top = MetadataInt(metadata, "/imgdesc/Top", 0);
                var disposal = MetadataInt(metadata, "/grctlext/Disposal", 0);
                var delay = MetadataInt(metadata, "/grctlext/Delay", 10);
                if (left < 0 || top < 0 || left + source.PixelWidth > width || top + source.PixelHeight > height)
                    throw new InvalidDataException("A GetANNY logo frame falls outside its logical canvas.");

                BitmapSource pixels = source.Format == PixelFormats.Bgra32
                    ? source
                    : new FormatConvertedBitmap(source, PixelFormats.Bgra32, null, 0);
                if (pixels.CanFreeze) pixels.Freeze();
                var stride = checked(pixels.PixelWidth * 4);
                var bytes = new byte[checked(stride * pixels.PixelHeight)];
                pixels.CopyPixels(bytes, stride, 0);
                _frames.Add(new Frame(left, top, pixels.PixelWidth, pixels.PixelHeight, stride, bytes, Math.Max(1, delay), disposal));
            }

            ReadLoopExtension(decoder.Metadata as BitmapMetadata, out _hasLoopExtension, out _extraLoops);
            _nextFrame = 0;
            _playsCompleted = 0;
            _previous = null;
            _restoreCanvas = null;
            PresentFrame(_frames[_nextFrame]);
            _nextFrame = 1;
            ScheduleNext(_frames[0]);
            UpdatePlayback();
        }
        catch (Exception error)
        {
            ReleaseAnimation();
            System.Diagnostics.Trace.TraceError("GetANNY setup logo animation failed: {0}", error);
            SetupLog.Warn("The embedded logo animation could not be decoded: " + error.Message);
        }
    }

    private static int MetadataInt(BitmapMetadata? metadata, string query, int fallback)
    {
        try
        {
            var value = metadata?.GetQuery(query);
            return value is null ? fallback : Convert.ToInt32(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException or FormatException or OverflowException)
        {
            return fallback;
        }
    }

    private static void ReadLoopExtension(BitmapMetadata? metadata, out bool present, out int extraLoops)
    {
        present = false;
        extraLoops = 0;
        try
        {
            if (metadata?.GetQuery("/appext/Data") is not byte[] data || data.Length < 4 || data[0] != 3 || data[1] != 1)
                return;
            present = true;
            extraLoops = data[2] | (data[3] << 8); // Netscape loop count: zero means infinite.
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            // GIFs without a Netscape extension play once; the supplied brand GIF
            // has the standard NETSCAPE2.0 extension with a zero (infinite) count.
        }
    }

    private void PresentFrame(Frame frame)
    {
        if (_canvas is null || _bitmap is null) return;

        if (_previous is not null)
        {
            if (_previous.Disposal == 2)
                FillBackground(_canvas, _previous.Left, _previous.Top, _previous.Width, _previous.Height, _bitmap.PixelWidth, _bitmap.PixelHeight, _backgroundColor);
            else if (_previous.Disposal == 3 && _restoreCanvas is not null)
                Buffer.BlockCopy(_restoreCanvas, 0, _canvas, 0, _canvas.Length);
        }

        _restoreCanvas = frame.Disposal == 3 ? (byte[])_canvas.Clone() : null;
        Composite(frame, _canvas, _bitmap.PixelWidth, _backgroundColor);
        _bitmap.WritePixels(new Int32Rect(0, 0, _bitmap.PixelWidth, _bitmap.PixelHeight), _canvas, _bitmap.PixelWidth * 4, 0);
        Source = _bitmap;
        _previous = frame;
    }

    private static void Composite(Frame frame, byte[] canvas, int canvasWidth, Color background)
    {
        for (var y = 0; y < frame.Height; y++)
        {
            var sourceOffset = y * frame.Stride;
            var targetOffset = ((frame.Top + y) * canvasWidth + frame.Left) * 4;
            for (var x = 0; x < frame.Width; x++, sourceOffset += 4, targetOffset += 4)
            {
                var alpha = frame.Pixels[sourceOffset + 3];
                if (alpha == 0) continue;
                // The supplied animation is authored on pure black. Re-matte its
                // RGB against the installer's near-black surface so both the black
                // field and anti-aliased logo edges blend without a visible tile.
                var blue = RematteBlack(frame.Pixels[sourceOffset], background.B);
                var green = RematteBlack(frame.Pixels[sourceOffset + 1], background.G);
                var red = RematteBlack(frame.Pixels[sourceOffset + 2], background.R);
                if (alpha == 255)
                {
                    canvas[targetOffset] = blue;
                    canvas[targetOffset + 1] = green;
                    canvas[targetOffset + 2] = red;
                    canvas[targetOffset + 3] = 255;
                    continue;
                }

                var inverse = 255 - alpha;
                canvas[targetOffset] = Blend(blue, canvas[targetOffset], alpha, inverse);
                canvas[targetOffset + 1] = Blend(green, canvas[targetOffset + 1], alpha, inverse);
                canvas[targetOffset + 2] = Blend(red, canvas[targetOffset + 2], alpha, inverse);
                canvas[targetOffset + 3] = (byte)(alpha + (canvas[targetOffset + 3] * inverse + 127) / 255);
            }
        }
    }

    private static byte Blend(byte source, byte target, int alpha, int inverse) =>
        (byte)((source * alpha + target * inverse + 127) / 255);

    private static byte RematteBlack(byte source, byte background) =>
        (byte)(background + (source * (255 - background) + 127) / 255);

    private static void FillBackground(byte[] canvas, int left, int top, int width, int height, int canvasWidth, int canvasHeight, Color background)
    {
        var right = Math.Min(canvasWidth, left + width);
        var bottom = Math.Min(canvasHeight, top + height);
        for (var y = Math.Max(0, top); y < bottom; y++)
        {
            var offset = (y * canvasWidth + Math.Max(0, left)) * 4;
            for (var x = Math.Max(0, left); x < right; x++, offset += 4)
            {
                canvas[offset] = background.B;
                canvas[offset + 1] = background.G;
                canvas[offset + 2] = background.R;
                canvas[offset + 3] = 255;
            }
        }
    }

    private void OnFrameTick(object? sender, EventArgs e)
    {
        if (_frames.Count == 0) { _timer.Stop(); return; }
        if (_nextFrame >= _frames.Count)
        {
            _playsCompleted++;
            var canRepeat = _hasLoopExtension && (_extraLoops == 0 || _playsCompleted <= _extraLoops);
            if (!canRepeat) { _timer.Stop(); return; }
            _nextFrame = 0;
        }

        var frame = _frames[_nextFrame++];
        PresentFrame(frame);
        ScheduleNext(frame);
    }

    private void ScheduleNext(Frame frame) =>
        _timer.Interval = TimeSpan.FromMilliseconds(Math.Max(10, frame.DelayCentiseconds * 10));

    private void UpdatePlayback()
    {
        var shouldPlay = _loaded && IsVisible && _windowActive && !_windowMinimized && _frames.Count > 1;
        if (shouldPlay)
        {
            if (!_timer.IsEnabled) _timer.Start();
        }
        else
        {
            _timer.Stop();
        }
    }

    private void ReleaseAnimation()
    {
        Source = null;
        _frames.Clear();
        _canvas = null;
        _restoreCanvas = null;
        _bitmap = null;
        _previous = null;
        _nextFrame = 0;
        _playsCompleted = 0;
    }

    private sealed record Frame(int Left, int Top, int Width, int Height, int Stride, byte[] Pixels, int DelayCentiseconds, int Disposal);
}
