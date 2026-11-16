import Log from "../utils/logger.js";
import { MPEG4AudioObjectTypes } from "./mpeg4-audio.js";
// MPEG audio version ID in the frame header
var MPEGAudioVersion;
(function (MPEGAudioVersion) {
    MPEGAudioVersion[MPEGAudioVersion["kMPEG25"] = 0] = "kMPEG25";
    MPEGAudioVersion[MPEGAudioVersion["kReserved"] = 1] = "kReserved";
    MPEGAudioVersion[MPEGAudioVersion["kMPEG2"] = 2] = "kMPEG2";
    MPEGAudioVersion[MPEGAudioVersion["kMPEG1"] = 3] = "kMPEG1";
})(MPEGAudioVersion || (MPEGAudioVersion = {}));
// Layer description in the frame header, which is in reverse order of the layer number
var MPEGAudioLayer;
(function (MPEGAudioLayer) {
    MPEGAudioLayer[MPEGAudioLayer["kReserved"] = 0] = "kReserved";
    MPEGAudioLayer[MPEGAudioLayer["kLayer3"] = 1] = "kLayer3";
    MPEGAudioLayer[MPEGAudioLayer["kLayer2"] = 2] = "kLayer2";
    MPEGAudioLayer[MPEGAudioLayer["kLayer1"] = 3] = "kLayer1";
})(MPEGAudioLayer || (MPEGAudioLayer = {}));
// Indexed by [MPEGAudioVersion][sampling_frequency_index]
const sample_rate_table = [
    [11025, 12000, 8000], // MPEG-2.5
    [], // reserved
    [22050, 24000, 16000], // MPEG-2
    [44100, 48000, 32000], // MPEG-1
];
// Bitrates in kbps, indexed by [MPEGAudioLayer][bitrate_index].
// Index 0 means free format, index 15 is invalid.
const mpeg1_bit_rate_table = [
    [], // reserved
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // Layer III
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // Layer II
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // Layer I
];
// MPEG-2 and MPEG-2.5 share the same bitrates, which differ from MPEG-1
const mpeg2_bit_rate_table = [
    [], // reserved
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // Layer III
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // Layer II
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], // Layer I
];
// Indexed by [MPEGAudioLayer]
const object_type_table = [
    MPEG4AudioObjectTypes.kNull, // reserved
    MPEG4AudioObjectTypes.kLayer3,
    MPEG4AudioObjectTypes.kLayer2,
    MPEG4AudioObjectTypes.kLayer1,
];
// Splits MPEG audio data into frames. A frame running past the end of data, or the last few
// bytes that may begin the next frame header, can be taken by getIncompleteData() and
// prepended to the data that follows.
export class MP3FrameParser {
    constructor(data) {
        this.TAG = "MP3FrameParser";
        this.eof_flag_ = false;
        this.has_last_incomplete_data_ = false;
        this.data_ = data;
        this.current_syncword_offset_ = this.findNextSyncwordOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, `Could not find MPEG audio frame header until payload end`);
        }
    }
    findNextSyncwordOffset(syncword_offset) {
        let i = syncword_offset;
        const data = this.data_;
        while (true) {
            if (i + 4 > data.byteLength) {
                // Not enough data for a frame header, but a syncword beginning in the
                // remaining bytes may start a frame that continues in the next payload
                while (i < data.byteLength && !this.mayBeginSyncword(i)) {
                    i++;
                }
                this.eof_flag_ = true;
                this.has_last_incomplete_data_ = i < data.byteLength;
                return i;
            }
            // search 11-bit 0x7FF syncword followed by a supported frame header
            const header = this.parseFrameHeader(i);
            if (header != null) {
                if (i === syncword_offset) {
                    // found where a frame is expected: at the beginning, or right after the previous frame
                    return i;
                }
                // Found by scanning, it may be a fake syncword inside audio data. Accept it only if
                // it is followed by another frame header, unless data ends before that can be checked
                const next_offset = i + header.frame_length;
                if (next_offset + 4 > data.byteLength || this.parseFrameHeader(next_offset) != null) {
                    return i;
                }
            }
            i++;
        }
    }
    // Whether the bytes from offset to the end of data may be the beginning of a syncword
    mayBeginSyncword(offset) {
        const data = this.data_;
        if (data[offset] !== 0xFF) {
            return false;
        }
        return offset + 1 === data.byteLength || (data[offset + 1] & 0xE0) === 0xE0;
    }
    // Parses the 4-byte frame header at offset, returns null if there is no supported frame header
    parseFrameHeader(offset) {
        const data = this.data_;
        // syncword: 11 bits all set
        if (data[offset + 0] !== 0xFF || (data[offset + 1] & 0xE0) !== 0xE0) {
            return null;
        }
        const version = (data[offset + 1] & 0x18) >>> 3;
        const layer = (data[offset + 1] & 0x06) >>> 1;
        const bit_rate_index = (data[offset + 2] & 0xF0) >>> 4;
        const sampling_frequency_index = (data[offset + 2] & 0x0C) >>> 2;
        const padding = (data[offset + 2] & 0x02) >>> 1;
        const channel_mode = (data[offset + 3] & 0xC0) >>> 6;
        if (version === MPEGAudioVersion.kReserved || layer === MPEGAudioLayer.kReserved || sampling_frequency_index === 3) {
            // reserved values
            return null;
        }
        if (bit_rate_index === 0 || bit_rate_index === 15) {
            // free format (frame length is unknown) is not supported, 15 is invalid
            return null;
        }
        const sample_rate = sample_rate_table[version][sampling_frequency_index];
        const bit_rate_table = (version === MPEGAudioVersion.kMPEG1) ? mpeg1_bit_rate_table : mpeg2_bit_rate_table;
        const bit_rate = bit_rate_table[layer][bit_rate_index];
        let samples_per_frame = 1152;
        if (layer === MPEGAudioLayer.kLayer1) {
            samples_per_frame = 384;
        }
        else if (layer === MPEGAudioLayer.kLayer3 && version !== MPEGAudioVersion.kMPEG1) {
            // Layer III frames of MPEG-2 and MPEG-2.5 carry half as many samples
            samples_per_frame = 576;
        }
        let frame_length = 0;
        if (layer === MPEGAudioLayer.kLayer1) {
            // Layer I frames are made of 4-byte slots
            frame_length = (Math.floor(12 * bit_rate * 1000 / sample_rate) + padding) * 4;
        }
        else {
            frame_length = Math.floor(samples_per_frame / 8 * bit_rate * 1000 / sample_rate) + padding;
        }
        return {
            object_type: object_type_table[layer],
            sample_rate: sample_rate,
            channel_count: channel_mode === 3 ? 1 : 2, // 3: single channel
            bit_rate: bit_rate,
            samples_per_frame: samples_per_frame,
            frame_length: frame_length,
        };
    }
    readNextMP3Frame() {
        if (this.eof_flag_) {
            return null;
        }
        const offset = this.current_syncword_offset_;
        // findNextSyncwordOffset() only stops at supported frame headers
        const header = this.parseFrameHeader(offset);
        if (offset + header.frame_length > this.data_.byteLength) {
            // data not enough for extracting last frame
            this.eof_flag_ = true;
            this.has_last_incomplete_data_ = true;
            return null;
        }
        this.current_syncword_offset_ = this.findNextSyncwordOffset(offset + header.frame_length);
        return {
            object_type: header.object_type,
            sample_rate: header.sample_rate,
            channel_count: header.channel_count,
            bit_rate: header.bit_rate,
            samples_per_frame: header.samples_per_frame,
            data: this.data_.subarray(offset, offset + header.frame_length),
        };
    }
    hasIncompleteData() {
        return this.has_last_incomplete_data_;
    }
    getIncompleteData() {
        if (!this.has_last_incomplete_data_) {
            return null;
        }
        return this.data_.subarray(this.current_syncword_offset_);
    }
}
