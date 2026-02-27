using System.IO.Ports;
using Serilog;

namespace Stratus.Desktop.Services.PakBus;

/// <summary>
/// Manages serial/USB communication with Campbell Scientific dataloggers.
/// Wraps System.IO.Ports.SerialPort with PakBus-aware buffering.
/// </summary>
public class SerialPortService : IDisposable
{
    private SerialPort? _port;
    private readonly byte[] _receiveBuffer = new byte[8192];
    private int _bufferLength;
    private bool _disposed;

    public bool IsOpen => _port?.IsOpen == true;
    public string PortName => _port?.PortName ?? "(none)";

    /// <summary>Fires when raw bytes arrive from the serial port.</summary>
    public event EventHandler<byte[]>? DataReceived;
    /// <summary>Fires on serial port errors.</summary>
    public event EventHandler<string>? ErrorOccurred;
    /// <summary>Fires when a complete PakBus packet is detected in the buffer.</summary>
    public event EventHandler<PakBusMessage>? PacketReceived;

    private readonly PakBusProtocol _protocol;

    public SerialPortService(PakBusProtocol protocol)
    {
        _protocol = protocol;
    }

    /// <summary>
    /// Get list of available COM ports (USB serial adapters, virtual COM ports, etc.)
    /// </summary>
    public static string[] GetAvailablePorts()
    {
        try
        {
            return SerialPort.GetPortNames().OrderBy(p => p).ToArray();
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to enumerate serial ports");
            return Array.Empty<string>();
        }
    }

    /// <summary>
    /// Open serial connection to a datalogger.
    /// Default: 115200 baud (USB), 8N1.
    /// </summary>
    public bool Open(string portName, int baudRate = 115200)
    {
        try
        {
            Close();

            _port = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One)
            {
                ReadTimeout = 5000,
                WriteTimeout = 5000,
                DtrEnable = true,
                RtsEnable = true,
                ReceivedBytesThreshold = 1
            };

            _port.DataReceived += Port_DataReceived;
            _port.ErrorReceived += Port_ErrorReceived;
            _port.Open();

            _bufferLength = 0;
            Log.Information("Serial port {Port} opened at {Baud} baud", portName, baudRate);
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to open serial port {Port}", portName);
            ErrorOccurred?.Invoke(this, $"Failed to open {portName}: {ex.Message}");
            return false;
        }
    }

    /// <summary>Close the serial port.</summary>
    public void Close()
    {
        if (_port != null)
        {
            try
            {
                if (_port.IsOpen)
                {
                    _port.DataReceived -= Port_DataReceived;
                    _port.ErrorReceived -= Port_ErrorReceived;
                    _port.Close();
                }
                _port.Dispose();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Error closing serial port");
            }
            _port = null;
        }
        _bufferLength = 0;
    }

    /// <summary>Send raw bytes over the serial port.</summary>
    public bool Send(byte[] data)
    {
        if (_port == null || !_port.IsOpen) return false;

        try
        {
            _port.Write(data, 0, data.Length);
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to write to serial port");
            ErrorOccurred?.Invoke(this, $"Write error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Send a PakBus command and wait for a response with the matching transaction number.
    /// </summary>
    public async Task<PakBusMessage?> SendAndWaitAsync(byte[] packet, int timeoutMs = 5000)
    {
        if (_port == null || !_port.IsOpen) return null;

        var tcs = new TaskCompletionSource<PakBusMessage?>();
        using var cts = new CancellationTokenSource(timeoutMs);
        cts.Token.Register(() => tcs.TrySetResult(null));

        void OnPacket(object? s, PakBusMessage msg) => tcs.TrySetResult(msg);
        PacketReceived += OnPacket;

        try
        {
            Send(packet);
            return await tcs.Task;
        }
        finally
        {
            PacketReceived -= OnPacket;
        }
    }

    private void Port_DataReceived(object sender, SerialDataReceivedEventArgs e)
    {
        if (_port == null || !_port.IsOpen) return;

        try
        {
            var bytesToRead = _port.BytesToRead;
            if (bytesToRead <= 0) return;

            var data = new byte[bytesToRead];
            var read = _port.Read(data, 0, bytesToRead);
            if (read <= 0) return;

            // Fire raw data event
            var rawData = new byte[read];
            Buffer.BlockCopy(data, 0, rawData, 0, read);
            DataReceived?.Invoke(this, rawData);

            // Buffer for PakBus packet assembly
            if (_bufferLength + read > _receiveBuffer.Length)
            {
                // Buffer overflow — reset
                _bufferLength = 0;
                Log.Warning("PakBus receive buffer overflow, resetting");
            }

            Buffer.BlockCopy(data, 0, _receiveBuffer, _bufferLength, read);
            _bufferLength += read;

            // Try to extract complete PakBus packets
            ProcessBuffer();
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Error reading serial data");
        }
    }

    private void ProcessBuffer()
    {
        int offset = 0;
        while (offset < _bufferLength)
        {
            var msg = _protocol.TryParsePacket(_receiveBuffer, offset, _bufferLength - offset, out int consumed);
            if (msg != null)
            {
                offset += consumed;
                PacketReceived?.Invoke(this, msg);
            }
            else
            {
                break;
            }
        }

        // Shift remaining data to front of buffer
        if (offset > 0 && offset < _bufferLength)
        {
            Buffer.BlockCopy(_receiveBuffer, offset, _receiveBuffer, 0, _bufferLength - offset);
            _bufferLength -= offset;
        }
        else if (offset >= _bufferLength)
        {
            _bufferLength = 0;
        }
    }

    private void Port_ErrorReceived(object sender, SerialErrorReceivedEventArgs e)
    {
        var msg = $"Serial error: {e.EventType}";
        Log.Warning(msg);
        ErrorOccurred?.Invoke(this, msg);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Close();
        GC.SuppressFinalize(this);
    }
}
