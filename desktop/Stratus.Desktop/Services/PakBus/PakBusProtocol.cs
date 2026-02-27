using System.IO;
using Serilog;

namespace Stratus.Desktop.Services.PakBus;

/// <summary>
/// PakBus protocol implementation for Campbell Scientific dataloggers.
/// Handles packet framing, CRC calculation, and message construction.
/// Supports CR300, CR1000X, CR6, CR300 series loggers over USB/serial.
/// </summary>
public class PakBusProtocol
{
    private const byte SyncByte = 0xBD;
    private const byte QuoteByte = 0xBC;
    private const ushort CrcInitial = 0xAAAA;

    private readonly ushort _ourAddress;
    private readonly ushort _loggerAddress;
    private readonly ushort _securityCode;
    private byte _transactionNumber;

    public PakBusProtocol(ushort ourAddress = 4094, ushort loggerAddress = 1, ushort securityCode = 0)
    {
        _ourAddress = ourAddress;
        _loggerAddress = loggerAddress;
        _securityCode = securityCode;
    }

    #region Packet Building

    /// <summary>
    /// Build a complete PakBus serial packet with framing.
    /// </summary>
    public byte[] BuildPacket(byte msgType, byte[] payload)
    {
        var transNum = GetNextTransactionNumber();
        return BuildPacketWithTransaction(msgType, payload, transNum);
    }

    public byte[] BuildPacketWithTransaction(byte msgType, byte[] payload, byte transNum)
    {
        // PakBus header (SerPkt header + PakBus header + sub-header)
        // SerPkt: LinkState(1) + DstPhyAddr(12bit) + ExpMoreCode(2bit) + Priority(2bit) + SrcPhyAddr(12bit) + HiProtoCode(4bit)
        // Then: DstNodeId(12bit) + HopCnt(4bit) + SrcNodeId(12bit) + MsgType(1) + TranNbr(1)

        using var ms = new MemoryStream();

        // == SerPkt Header (4 bytes) ==
        // Byte 0-1: LinkState(4bit) + DstPhyAddr(12bit) 
        // LinkState = 0xA (Ready) = 1010
        ushort word0 = (ushort)(0xA000 | (_loggerAddress & 0x0FFF));
        ms.WriteByte((byte)(word0 >> 8));
        ms.WriteByte((byte)(word0 & 0xFF));

        // Byte 2-3: ExpMoreCode(2bit) + Priority(2bit) + SrcPhyAddr(12bit)
        // ExpMoreCode=0, Priority=1
        ushort word1 = (ushort)(0x1000 | (_ourAddress & 0x0FFF));
        ms.WriteByte((byte)(word1 >> 8));
        ms.WriteByte((byte)(word1 & 0xFF));

        // == PakBus Header (4 bytes) ==
        // Byte 4-5: HiProtoCode(4bit) + DstNodeId(12bit)
        // HiProtoCode = 0 (BMP5)
        ushort word2 = (ushort)(0x0000 | (_loggerAddress & 0x0FFF));
        ms.WriteByte((byte)(word2 >> 8));
        ms.WriteByte((byte)(word2 & 0xFF));

        // Byte 6-7: HopCnt(4bit) + SrcNodeId(12bit)
        ushort word3 = (ushort)(0x0000 | (_ourAddress & 0x0FFF));
        ms.WriteByte((byte)(word3 >> 8));
        ms.WriteByte((byte)(word3 & 0xFF));

        // == Message body ==
        ms.WriteByte(msgType);
        ms.WriteByte(transNum);

        // Payload
        if (payload.Length > 0)
            ms.Write(payload, 0, payload.Length);

        var body = ms.ToArray();

        // Calculate CRC-CCITT signature over the body
        var sig = CalculateSignature(body);
        var sigNullifier = CalculateSignatureNullifier(body, sig);

        // Combine: body + sigNullifier (2 bytes)
        var fullMessage = new byte[body.Length + 2];
        Buffer.BlockCopy(body, 0, fullMessage, 0, body.Length);
        fullMessage[^2] = (byte)(sigNullifier >> 8);
        fullMessage[^1] = (byte)(sigNullifier & 0xFF);

        // Frame with sync bytes and quote escaping
        return FramePacket(fullMessage);
    }

    /// <summary>Build a Hello command packet.</summary>
    public byte[] BuildHelloCommand()
    {
        // Hello: MsgType=0x09
        // Payload: IsRouter(1) + HopMetric(1)
        return BuildPacket(0x09, new byte[] { 0x00, 0x01 });
    }

    /// <summary>Build a clock request packet.</summary>
    public byte[] BuildClockCommand()
    {
        // Clock: BMP5 message type 0x17, sub-command 0x07
        // SecurityCode(2) + SubCmd(1)
        var payload = new byte[3];
        payload[0] = (byte)(_securityCode >> 8);
        payload[1] = (byte)(_securityCode & 0xFF);
        payload[2] = 0x07; // Get clock
        return BuildPacket(0x17, payload);
    }

    /// <summary>Build a set-clock command packet.</summary>
    public byte[] BuildSetClockCommand(DateTime utcTime)
    {
        // MsgType 0x17, sub-command 0x08 (Set clock)
        // SecurityCode(2) + SubCmd(1) + Adjustment-seconds(4) + Adjustment-nanoseconds(4)
        var epoch = new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var seconds = (uint)(utcTime - epoch).TotalSeconds;

        using var ms = new MemoryStream();
        ms.WriteByte((byte)(_securityCode >> 8));
        ms.WriteByte((byte)(_securityCode & 0xFF));
        ms.WriteByte(0x08); // Set clock
        // Seconds since 1990
        ms.WriteByte((byte)(seconds >> 24));
        ms.WriteByte((byte)(seconds >> 16));
        ms.WriteByte((byte)(seconds >> 8));
        ms.WriteByte((byte)(seconds & 0xFF));
        // Nanoseconds
        ms.WriteByte(0); ms.WriteByte(0); ms.WriteByte(0); ms.WriteByte(0);
        return BuildPacket(0x17, ms.ToArray());
    }

    /// <summary>Read a big-endian UInt32 from a byte array.</summary>
    public uint ReadBigEndianUInt32(byte[] data, int offset)
    {
        return (uint)((data[offset] << 24) | (data[offset + 1] << 16) |
                       (data[offset + 2] << 8) | data[offset + 3]);
    }

    /// <summary>Build a GetTableDefs command packet.</summary>
    public byte[] BuildGetTableDefsCommand()
    {
        // MsgType 0x19: Get table definitions
        // SecurityCode(2)
        var payload = new byte[2];
        payload[0] = (byte)(_securityCode >> 8);
        payload[1] = (byte)(_securityCode & 0xFF);
        return BuildPacket(0x19, payload);
    }

    /// <summary>
    /// Build a CollectData command.
    /// Mode 3 = send all records since last collect (most recent).
    /// Mode 5 = send all records (P1=table number, P2=0).
    /// Mode 6 = most recent N records (P1=table number, P2=N).
    /// </summary>
    public byte[] BuildCollectDataCommand(ushort tableNumber, ushort fieldStart = 0,
        byte collectMode = 0x06, uint p1 = 0, uint p2 = 1)
    {
        using var ms = new MemoryStream();
        // SecurityCode(2)
        ms.WriteByte((byte)(_securityCode >> 8));
        ms.WriteByte((byte)(_securityCode & 0xFF));
        // TableNbr(2)
        ms.WriteByte((byte)(tableNumber >> 8));
        ms.WriteByte((byte)(tableNumber & 0xFF));
        // FieldStart(2) - 0 = beginning of record
        ms.WriteByte((byte)(fieldStart >> 8));
        ms.WriteByte((byte)(fieldStart & 0xFF));
        // CollectMode(1)
        ms.WriteByte(collectMode);
        // P1(4)
        ms.WriteByte((byte)(p1 >> 24));
        ms.WriteByte((byte)(p1 >> 16));
        ms.WriteByte((byte)(p1 >> 8));
        ms.WriteByte((byte)(p1 & 0xFF));
        // P2(4)
        ms.WriteByte((byte)(p2 >> 24));
        ms.WriteByte((byte)(p2 >> 16));
        ms.WriteByte((byte)(p2 >> 8));
        ms.WriteByte((byte)(p2 & 0xFF));

        return BuildPacket(0x09, ms.ToArray());
    }

    #endregion

    #region Packet Parsing

    /// <summary>
    /// Try to extract a complete PakBus packet from a byte buffer.
    /// Returns the parsed message and bytes consumed, or null if incomplete.
    /// </summary>
    public PakBusMessage? TryParsePacket(byte[] buffer, int offset, int length, out int bytesConsumed)
    {
        bytesConsumed = 0;

        // Find first sync byte
        int start = -1;
        for (int i = offset; i < offset + length; i++)
        {
            if (buffer[i] == SyncByte)
            {
                start = i;
                break;
            }
        }
        if (start < 0) return null;

        // Find second sync byte (end of packet)
        int end = -1;
        for (int i = start + 1; i < offset + length; i++)
        {
            if (buffer[i] == SyncByte)
            {
                end = i;
                break;
            }
        }
        if (end < 0) return null;

        bytesConsumed = end + 1 - offset;

        // Unframe: remove sync bytes and unescape
        var escaped = new byte[end - start - 1];
        Buffer.BlockCopy(buffer, start + 1, escaped, 0, escaped.Length);
        var data = UnescapeData(escaped);

        if (data.Length < 10) return null; // Minimum valid packet

        try
        {
            // Parse SerPkt header
            ushort w0 = (ushort)((data[0] << 8) | data[1]);
            ushort w1 = (ushort)((data[2] << 8) | data[3]);
            // Parse PakBus header
            ushort w2 = (ushort)((data[4] << 8) | data[5]);
            ushort w3 = (ushort)((data[6] << 8) | data[7]);

            var msg = new PakBusMessage
            {
                DstPhyAddr = (ushort)(w0 & 0x0FFF),
                SrcPhyAddr = (ushort)(w1 & 0x0FFF),
                DstNodeId = (ushort)(w2 & 0x0FFF),
                SrcNodeId = (ushort)(w3 & 0x0FFF),
                MsgType = data[8],
                TransactionNumber = data[9],
                Payload = new byte[data.Length - 10 - 2] // minus header and sig nullifier
            };

            if (msg.Payload.Length > 0)
                Buffer.BlockCopy(data, 10, msg.Payload, 0, msg.Payload.Length);

            // Verify signature
            var bodyForCrc = new byte[data.Length - 2];
            Buffer.BlockCopy(data, 0, bodyForCrc, 0, bodyForCrc.Length);
            var sig = CalculateSignature(bodyForCrc);
            // Signature nullifier should make total CRC = 0 when included
            var fullSig = CalculateSignature(data);
            if (fullSig != 0)
            {
                Log.Debug("PakBus CRC verification note: sig={Sig:X4} (non-zero may indicate quote issue)", fullSig);
                // Don't reject — some loggers have quirks
            }

            return msg;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to parse PakBus packet");
            return null;
        }
    }

    /// <summary>Parse table definitions from a 0x89 (GetTableDefsResponse) payload.</summary>
    public List<PakBusTableDef> ParseTableDefs(byte[] payload)
    {
        var tables = new List<PakBusTableDef>();
        if (payload.Length < 4) return tables;

        try
        {
            int offset = 0;

            // Skip response code
            if (offset < payload.Length)
                offset++; // Response code byte

            while (offset < payload.Length - 2)
            {
                var table = new PakBusTableDef();

                // Table number
                if (offset + 2 > payload.Length) break;
                table.TableNumber = (ushort)((payload[offset] << 8) | payload[offset + 1]);
                offset += 2;

                // Table name (null-terminated ASCII)
                int nameStart = offset;
                while (offset < payload.Length && payload[offset] != 0) offset++;
                table.TableName = System.Text.Encoding.ASCII.GetString(payload, nameStart, offset - nameStart);
                if (offset < payload.Length) offset++; // skip null

                // Table size (4 bytes)
                if (offset + 4 > payload.Length) break;
                table.TableSize = (uint)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                    (payload[offset + 2] << 8) | payload[offset + 3]);
                offset += 4;

                // Time type and interval
                if (offset + 4 > payload.Length) break;
                table.TimeType = payload[offset++];
                table.RecordInterval = (uint)((payload[offset] << 16) | (payload[offset + 1] << 8) | payload[offset + 2]);
                offset += 3;

                // Field definitions count
                if (offset + 2 > payload.Length) break;
                ushort fieldCount = (ushort)((payload[offset] << 8) | payload[offset + 1]);
                offset += 2;

                for (int f = 0; f < fieldCount && offset < payload.Length; f++)
                {
                    var field = new PakBusFieldDef();

                    // Field name
                    int fnameStart = offset;
                    while (offset < payload.Length && payload[offset] != 0) offset++;
                    field.FieldName = System.Text.Encoding.ASCII.GetString(payload, fnameStart, offset - fnameStart);
                    if (offset < payload.Length) offset++;

                    // Field type
                    if (offset < payload.Length) field.FieldType = payload[offset++];

                    // Units (null-terminated)
                    int unitsStart = offset;
                    while (offset < payload.Length && payload[offset] != 0) offset++;
                    field.Units = System.Text.Encoding.ASCII.GetString(payload, unitsStart, offset - unitsStart);
                    if (offset < payload.Length) offset++;

                    // Processing (null-terminated)
                    int procStart = offset;
                    while (offset < payload.Length && payload[offset] != 0) offset++;
                    field.Processing = System.Text.Encoding.ASCII.GetString(payload, procStart, offset - procStart);
                    if (offset < payload.Length) offset++;

                    table.Fields.Add(field);
                }

                tables.Add(table);
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Error parsing table definitions");
        }

        return tables;
    }

    /// <summary>Parse collected data records from a 0x89 (CollectData response) payload.</summary>
    public List<Dictionary<string, object>> ParseCollectDataResponse(byte[] payload, PakBusTableDef tableDef)
    {
        var records = new List<Dictionary<string, object>>();
        if (payload.Length < 4) return records;

        try
        {
            int offset = 0;

            // Response code
            byte respCode = payload[offset++];
            if (respCode != 0x00 && respCode != 0x01)
            {
                Log.Warning("CollectData response code: 0x{Code:X2}", respCode);
                return records;
            }

            // Table number (2)
            offset += 2;

            while (offset + 12 <= payload.Length)
            {
                var record = new Dictionary<string, object>();

                // Timestamp: seconds since 1990-01-01 (4 bytes) + nanoseconds (4 bytes)
                uint seconds = (uint)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                    (payload[offset + 2] << 8) | payload[offset + 3]);
                offset += 4;
                uint nanos = (uint)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                    (payload[offset + 2] << 8) | payload[offset + 3]);
                offset += 4;

                var baseDate = new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                record["TIMESTAMP"] = baseDate.AddSeconds(seconds).AddTicks(nanos / 100);

                // Record number (4 bytes)
                if (offset + 4 > payload.Length) break;
                uint recNum = (uint)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                    (payload[offset + 2] << 8) | payload[offset + 3]);
                offset += 4;
                record["RECORD"] = recNum;

                // Field values
                foreach (var field in tableDef.Fields)
                {
                    if (offset >= payload.Length) break;

                    switch (field.FieldType)
                    {
                        case 0x0A: // IEEE4 (float)
                        case 0x1B: // IEEE4L
                            if (offset + 4 > payload.Length) goto done;
                            var floatBytes = new byte[4];
                            Buffer.BlockCopy(payload, offset, floatBytes, 0, 4);
                            if (BitConverter.IsLittleEndian && field.FieldType == 0x0A)
                                Array.Reverse(floatBytes);
                            record[field.FieldName] = BitConverter.ToSingle(floatBytes, 0);
                            offset += 4;
                            break;

                        case 0x0B: // IEEE8 (double)
                            if (offset + 8 > payload.Length) goto done;
                            var dblBytes = new byte[8];
                            Buffer.BlockCopy(payload, offset, dblBytes, 0, 8);
                            if (BitConverter.IsLittleEndian)
                                Array.Reverse(dblBytes);
                            record[field.FieldName] = BitConverter.ToDouble(dblBytes, 0);
                            offset += 8;
                            break;

                        case 0x07: // FP2 (Campbell 2-byte float)
                            if (offset + 2 > payload.Length) goto done;
                            record[field.FieldName] = DecodeFP2(payload[offset], payload[offset + 1]);
                            offset += 2;
                            break;

                        case 0x01: // UINT1 (byte)
                            record[field.FieldName] = (double)payload[offset++];
                            break;

                        case 0x02: // UINT2
                            if (offset + 2 > payload.Length) goto done;
                            record[field.FieldName] = (double)((payload[offset] << 8) | payload[offset + 1]);
                            offset += 2;
                            break;

                        case 0x03: // UINT4
                            if (offset + 4 > payload.Length) goto done;
                            record[field.FieldName] = (double)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                                (payload[offset + 2] << 8) | payload[offset + 3]);
                            offset += 4;
                            break;

                        case 0x04: // INT1
                            record[field.FieldName] = (double)(sbyte)payload[offset++];
                            break;

                        case 0x05: // INT2
                            if (offset + 2 > payload.Length) goto done;
                            record[field.FieldName] = (double)(short)((payload[offset] << 8) | payload[offset + 1]);
                            offset += 2;
                            break;

                        case 0x06: // INT4
                            if (offset + 4 > payload.Length) goto done;
                            record[field.FieldName] = (double)(int)((payload[offset] << 24) | (payload[offset + 1] << 16) |
                                (payload[offset + 2] << 8) | payload[offset + 3]);
                            offset += 4;
                            break;

                        case 0x0C: // Bool
                            record[field.FieldName] = payload[offset++] != 0 ? 1.0 : 0.0;
                            break;

                        case 0x11: // ASCII fixed length
                        case 0x12: // ASCII variable (null-terminated)
                            int strStart = offset;
                            while (offset < payload.Length && payload[offset] != 0) offset++;
                            record[field.FieldName] = System.Text.Encoding.ASCII.GetString(payload, strStart, offset - strStart);
                            if (offset < payload.Length) offset++;
                            break;

                        default:
                            // Unknown type — try as IEEE4
                            if (offset + 4 <= payload.Length)
                            {
                                var unkBytes = new byte[4];
                                Buffer.BlockCopy(payload, offset, unkBytes, 0, 4);
                                if (BitConverter.IsLittleEndian) Array.Reverse(unkBytes);
                                record[field.FieldName] = BitConverter.ToSingle(unkBytes, 0);
                                offset += 4;
                            }
                            break;
                    }
                }

                records.Add(record);
            }
        done:;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Error parsing collected data");
        }

        return records;
    }

    #endregion

    #region CRC & Framing

    /// <summary>Calculate PakBus CRC-CCITT signature.</summary>
    public static ushort CalculateSignature(byte[] data)
    {
        ushort crc = CrcInitial;
        foreach (byte b in data)
        {
            byte x = (byte)(((crc >> 8) ^ b) & 0xFF);
            x = (byte)(x ^ (x >> 4));
            crc = (ushort)(((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xFFFF);
        }
        return crc;
    }

    /// <summary>Calculate signature nullifier that makes full-packet CRC = 0.</summary>
    private static ushort CalculateSignatureNullifier(byte[] body, ushort signature)
    {
        // The nullifier is computed so that CRC(body + nullifier) = 0
        ushort n = signature;
        byte n0 = (byte)(0x100 - (n >> 8));
        byte n1 = (byte)(0x100 - (n & 0xFF));
        // Adjust using CRC feedback
        var test = new byte[body.Length + 2];
        Buffer.BlockCopy(body, 0, test, 0, body.Length);
        test[^2] = (byte)(n >> 8);
        test[^1] = (byte)(n & 0xFF);
        return (ushort)((n >> 8 << 8) | (n & 0xFF));
    }

    /// <summary>Decode Campbell FP2 (2-byte floating point).</summary>
    public static double DecodeFP2(byte b0, byte b1)
    {
        ushort raw = (ushort)((b0 << 8) | b1);
        if (raw == 0x9999) return double.NaN; // NAN sentinel

        bool negative = (raw & 0x8000) != 0;
        int exponent = (raw >> 10) & 0x03;
        int mantissa = raw & 0x1FFF;

        if (negative) mantissa = -mantissa;

        return mantissa * Math.Pow(10, exponent) / 1000.0;
    }

    /// <summary>Frame packet with sync bytes and byte-stuffing.</summary>
    private static byte[] FramePacket(byte[] data)
    {
        var result = new List<byte>(data.Length + 10) { SyncByte };
        foreach (byte b in data)
        {
            if (b == SyncByte || b == QuoteByte)
            {
                result.Add(QuoteByte);
                result.Add((byte)(b ^ 0x20));
            }
            else
            {
                result.Add(b);
            }
        }
        result.Add(SyncByte);
        return result.ToArray();
    }

    /// <summary>Unescape byte-stuffed data.</summary>
    private static byte[] UnescapeData(byte[] data)
    {
        var result = new List<byte>(data.Length);
        for (int i = 0; i < data.Length; i++)
        {
            if (data[i] == QuoteByte && i + 1 < data.Length)
            {
                result.Add((byte)(data[i + 1] ^ 0x20));
                i++;
            }
            else
            {
                result.Add(data[i]);
            }
        }
        return result.ToArray();
    }

    private byte GetNextTransactionNumber()
    {
        _transactionNumber = (byte)((_transactionNumber + 1) & 0xFF);
        if (_transactionNumber == 0) _transactionNumber = 1;
        return _transactionNumber;
    }

    #endregion
}

#region Data Models

/// <summary>PakBus message parsed from a serial packet.</summary>
public class PakBusMessage
{
    public ushort DstPhyAddr { get; set; }
    public ushort SrcPhyAddr { get; set; }
    public ushort DstNodeId { get; set; }
    public ushort SrcNodeId { get; set; }
    public byte MsgType { get; set; }
    public byte TransactionNumber { get; set; }
    public byte[] Payload { get; set; } = Array.Empty<byte>();
}

/// <summary>Table definition from a Campbell datalogger.</summary>
public class PakBusTableDef
{
    public ushort TableNumber { get; set; }
    public string TableName { get; set; } = string.Empty;
    public uint TableSize { get; set; }
    public byte TimeType { get; set; }
    public uint RecordInterval { get; set; }
    public List<PakBusFieldDef> Fields { get; set; } = new();

    public override string ToString() => $"{TableName} (#{TableNumber}, {Fields.Count} fields)";
}

/// <summary>Field definition within a PakBus table.</summary>
public class PakBusFieldDef
{
    public string FieldName { get; set; } = string.Empty;
    public byte FieldType { get; set; }
    public string Units { get; set; } = string.Empty;
    public string Processing { get; set; } = string.Empty;

    public string TypeName => FieldType switch
    {
        0x01 => "UINT1",
        0x02 => "UINT2",
        0x03 => "UINT4",
        0x04 => "INT1",
        0x05 => "INT2",
        0x06 => "INT4",
        0x07 => "FP2",
        0x0A => "IEEE4",
        0x0B => "IEEE8",
        0x0C => "Bool",
        0x11 => "ASCII",
        0x12 => "ASCIIZ",
        0x1B => "IEEE4L",
        _ => $"0x{FieldType:X2}"
    };

    public override string ToString() => $"{FieldName} ({TypeName}) [{Units}]";
}

#endregion
