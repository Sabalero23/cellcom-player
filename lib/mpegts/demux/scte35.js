import ExpGolomb from './exp-golomb.js';
export var SCTE35CommandType;
(function (SCTE35CommandType) {
    SCTE35CommandType[SCTE35CommandType["kSpliceNull"] = 0] = "kSpliceNull";
    SCTE35CommandType[SCTE35CommandType["kSpliceSchedule"] = 4] = "kSpliceSchedule";
    SCTE35CommandType[SCTE35CommandType["kSpliceInsert"] = 5] = "kSpliceInsert";
    SCTE35CommandType[SCTE35CommandType["kTimeSignal"] = 6] = "kTimeSignal";
    SCTE35CommandType[SCTE35CommandType["kBandwidthReservation"] = 7] = "kBandwidthReservation";
    SCTE35CommandType[SCTE35CommandType["kPrivateCommand"] = 255] = "kPrivateCommand";
})(SCTE35CommandType || (SCTE35CommandType = {}));
const parseSpliceTime = (reader) => {
    const time_specified_flag = reader.readBool();
    if (!time_specified_flag) {
        reader.readBits(7);
        return { time_specified_flag };
    }
    else {
        reader.readBits(6);
        const pts_time = reader.readBits(31) * 4 + reader.readBits(2);
        return {
            time_specified_flag,
            pts_time
        };
    }
};
const parseBreakDuration = (reader) => {
    const auto_return = reader.readBool();
    reader.readBits(6);
    const duration = reader.readBits(31) * 4 + reader.readBits(2);
    return {
        auto_return,
        duration
    };
};
const parseSpliceInsertComponent = (splice_immediate_flag, reader) => {
    const component_tag = reader.readBits(8);
    if (splice_immediate_flag) {
        return { component_tag };
    }
    const splice_time = parseSpliceTime(reader);
    return {
        component_tag,
        splice_time
    };
};
const parseSpliceScheduleEventComponent = (reader) => {
    const component_tag = reader.readBits(8);
    const utc_splice_time = reader.readBits(32);
    return {
        component_tag,
        utc_splice_time
    };
};
const parseSpliceScheduleEvent = (reader) => {
    const splice_event_id = reader.readBits(32);
    const splice_event_cancel_indicator = reader.readBool();
    reader.readBits(7);
    const spliceScheduleEvent = {
        splice_event_id,
        splice_event_cancel_indicator
    };
    if (splice_event_cancel_indicator) {
        return spliceScheduleEvent;
    }
    spliceScheduleEvent.out_of_network_indicator = reader.readBool();
    spliceScheduleEvent.program_splice_flag = reader.readBool();
    spliceScheduleEvent.duration_flag = reader.readBool();
    reader.readBits(5);
    if (spliceScheduleEvent.program_splice_flag) {
        spliceScheduleEvent.utc_splice_time = reader.readBits(32);
    }
    else {
        spliceScheduleEvent.component_count = reader.readBits(8);
        spliceScheduleEvent.components = [];
        for (let i = 0; i < spliceScheduleEvent.component_count; i++) {
            spliceScheduleEvent.components.push(parseSpliceScheduleEventComponent(reader));
        }
    }
    if (spliceScheduleEvent.duration_flag) {
        spliceScheduleEvent.break_duration = parseBreakDuration(reader);
    }
    spliceScheduleEvent.unique_program_id = reader.readBits(16);
    spliceScheduleEvent.avail_num = reader.readBits(8);
    spliceScheduleEvent.avails_expected = reader.readBits(8);
    return spliceScheduleEvent;
};
const parseSpliceNull = () => {
    return {};
};
const parseSpliceSchedule = (reader) => {
    const splice_count = reader.readBits(8);
    const events = [];
    for (let i = 0; i < splice_count; i++) {
        events.push(parseSpliceScheduleEvent(reader));
    }
    return {
        splice_count,
        events
    };
};
const parseSpliceInsert = (reader) => {
    const splice_event_id = reader.readBits(32);
    const splice_event_cancel_indicator = reader.readBool();
    reader.readBits(7);
    const spliceInsert = {
        splice_event_id,
        splice_event_cancel_indicator
    };
    if (splice_event_cancel_indicator) {
        return spliceInsert;
    }
    spliceInsert.out_of_network_indicator = reader.readBool();
    spliceInsert.program_splice_flag = reader.readBool();
    spliceInsert.duration_flag = reader.readBool();
    spliceInsert.splice_immediate_flag = reader.readBool();
    reader.readBits(4);
    if (spliceInsert.program_splice_flag && !spliceInsert.splice_immediate_flag) {
        spliceInsert.splice_time = parseSpliceTime(reader);
    }
    if (!spliceInsert.program_splice_flag) {
        spliceInsert.component_count = reader.readBits(8);
        spliceInsert.components = [];
        for (let i = 0; i < spliceInsert.component_count; i++) {
            spliceInsert.components.push(parseSpliceInsertComponent(spliceInsert.splice_immediate_flag, reader));
        }
    }
    if (spliceInsert.duration_flag) {
        spliceInsert.break_duration = parseBreakDuration(reader);
    }
    spliceInsert.unique_program_id = reader.readBits(16);
    spliceInsert.avail_num = reader.readBits(8);
    spliceInsert.avails_expected = reader.readBits(8);
    return spliceInsert;
};
const parseTimeSignal = (reader) => {
    return {
        splice_time: parseSpliceTime(reader)
    };
};
const parseBandwidthReservation = () => {
    return {};
};
const parsePrivateCommand = (splice_command_length, reader) => {
    const identifier = String.fromCharCode(reader.readBits(8), reader.readBits(8), reader.readBits(8), reader.readBits(8));
    const data = new Uint8Array(splice_command_length - 4);
    for (let i = 0; i < splice_command_length - 4; i++) {
        data[i] = reader.readBits(8);
    }
    return {
        identifier,
        private_data: data.buffer
    };
};
const parseAvailDescriptor = (descriptor_tag, descriptor_length, identifier, reader) => {
    const provider_avail_id = reader.readBits(32);
    return {
        descriptor_tag,
        descriptor_length,
        identifier,
        provider_avail_id
    };
};
const parseDTMFDescriptor = (descriptor_tag, descriptor_length, identifier, reader) => {
    const preroll = reader.readBits(8);
    const dtmf_count = reader.readBits(3);
    reader.readBits(5);
    let DTMF_char = '';
    for (let i = 0; i < dtmf_count; i++) {
        DTMF_char += String.fromCharCode(reader.readBits(8));
    }
    return {
        descriptor_tag,
        descriptor_length,
        identifier,
        preroll,
        dtmf_count,
        DTMF_char
    };
};
const parseSegmentationDescriptorComponent = (reader) => {
    const component_tag = reader.readBits(8);
    reader.readBits(7);
    const pts_offset = reader.readBits(31) * 4 + reader.readBits(2);
    return {
        component_tag,
        pts_offset
    };
};
const parseSegmentationDescriptor = (descriptor_tag, descriptor_length, identifier, reader) => {
    const segmentation_event_id = reader.readBits(32);
    const segmentation_event_cancel_indicator = reader.readBool();
    reader.readBits(7);
    const segmentationDescriptor = {
        descriptor_tag,
        descriptor_length,
        identifier,
        segmentation_event_id,
        segmentation_event_cancel_indicator
    };
    if (segmentation_event_cancel_indicator) {
        return segmentationDescriptor;
    }
    segmentationDescriptor.program_segmentation_flag = reader.readBool();
    segmentationDescriptor.segmentation_duration_flag = reader.readBool();
    segmentationDescriptor.delivery_not_restricted_flag = reader.readBool();
    if (!segmentationDescriptor.delivery_not_restricted_flag) {
        segmentationDescriptor.web_delivery_allowed_flag = reader.readBool();
        segmentationDescriptor.no_regional_blackout_flag = reader.readBool();
        segmentationDescriptor.archive_allowed_flag = reader.readBool();
        segmentationDescriptor.device_restrictions = reader.readBits(2);
    }
    else {
        reader.readBits(5);
    }
    if (!segmentationDescriptor.program_segmentation_flag) {
        segmentationDescriptor.component_count = reader.readBits(8);
        segmentationDescriptor.components = [];
        for (let i = 0; i < segmentationDescriptor.component_count; i++) {
            segmentationDescriptor.components.push(parseSegmentationDescriptorComponent(reader));
        }
    }
    if (segmentationDescriptor.segmentation_duration_flag) {
        segmentationDescriptor.segmentation_duration = reader.readBits(40);
    }
    segmentationDescriptor.segmentation_upid_type = reader.readBits(8);
    segmentationDescriptor.segmentation_upid_length = reader.readBits(8);
    {
        const upid = new Uint8Array(segmentationDescriptor.segmentation_upid_length);
        for (let i = 0; i < segmentationDescriptor.segmentation_upid_length; i++) {
            upid[i] = reader.readBits(8);
        }
        segmentationDescriptor.segmentation_upid = upid.buffer;
    }
    segmentationDescriptor.segmentation_type_id = reader.readBits(8);
    segmentationDescriptor.segment_num = reader.readBits(8);
    segmentationDescriptor.segments_expected = reader.readBits(8);
    if (segmentationDescriptor.segmentation_type_id === 0x34 ||
        segmentationDescriptor.segmentation_type_id === 0x36 ||
        segmentationDescriptor.segmentation_type_id === 0x38 ||
        segmentationDescriptor.segmentation_type_id === 0x3A) {
        segmentationDescriptor.sub_segment_num = reader.readBits(8);
        segmentationDescriptor.sub_segments_expected = reader.readBits(8);
    }
    return segmentationDescriptor;
};
const parseTimeDescriptor = (descriptor_tag, descriptor_length, identifier, reader) => {
    const TAI_seconds = reader.readBits(48);
    const TAI_ns = reader.readBits(32);
    const UTC_offset = reader.readBits(16);
    return {
        descriptor_tag,
        descriptor_length,
        identifier,
        TAI_seconds,
        TAI_ns,
        UTC_offset
    };
};
const parseAudioDescriptorComponent = (reader) => {
    const component_tag = reader.readBits(8);
    const ISO_code = String.fromCharCode(reader.readBits(8), reader.readBits(8), reader.readBits(8));
    const Bit_Stream_Mode = reader.readBits(3);
    const Num_Channels = reader.readBits(4);
    const Full_Srvc_Audio = reader.readBool();
    return {
        component_tag,
        ISO_code,
        Bit_Stream_Mode,
        Num_Channels,
        Full_Srvc_Audio
    };
};
const parseAudioDescriptor = (descriptor_tag, descriptor_length, identifier, reader) => {
    const audio_count = reader.readBits(4);
    const components = [];
    for (let i = 0; i < audio_count; i++) {
        components.push(parseAudioDescriptorComponent(reader));
    }
    return {
        descriptor_tag,
        descriptor_length,
        identifier,
        audio_count,
        components
    };
};
export const readSCTE35 = (data) => {
    const reader = new ExpGolomb(data);
    const table_id = reader.readBits(8);
    const section_syntax_indicator = reader.readBool();
    const private_indicator = reader.readBool();
    reader.readBits(2);
    const section_length = reader.readBits(12);
    const protocol_version = reader.readBits(8);
    const encrypted_packet = reader.readBool();
    const encryption_algorithm = reader.readBits(6);
    const pts_adjustment = reader.readBits(31) * 4 + reader.readBits(2);
    const cw_index = reader.readBits(8);
    const tier = reader.readBits(12);
    const splice_command_length = reader.readBits(12);
    const splice_command_type = reader.readBits(8);
    let splice_command = null;
    if (splice_command_type === SCTE35CommandType.kSpliceNull) {
        splice_command = parseSpliceNull();
    }
    else if (splice_command_type === SCTE35CommandType.kSpliceSchedule) {
        splice_command = parseSpliceSchedule(reader);
    }
    else if (splice_command_type === SCTE35CommandType.kSpliceInsert) {
        splice_command = parseSpliceInsert(reader);
    }
    else if (splice_command_type === SCTE35CommandType.kTimeSignal) {
        splice_command = parseTimeSignal(reader);
    }
    else if (splice_command_type === SCTE35CommandType.kBandwidthReservation) {
        splice_command = parseBandwidthReservation();
    }
    else if (splice_command_type === SCTE35CommandType.kPrivateCommand) {
        splice_command = parsePrivateCommand(splice_command_length, reader);
    }
    else {
        reader.readBits(splice_command_length * 8);
    }
    const splice_descriptors = [];
    const descriptor_loop_length = reader.readBits(16);
    for (let length = 0; length < descriptor_loop_length;) {
        const descriptor_tag = reader.readBits(8);
        const descriptor_length = reader.readBits(8);
        const identifier = String.fromCharCode(reader.readBits(8), reader.readBits(8), reader.readBits(8), reader.readBits(8));
        if (descriptor_tag === 0x00) {
            splice_descriptors.push(parseAvailDescriptor(descriptor_tag, descriptor_length, identifier, reader));
        }
        else if (descriptor_tag === 0x01) {
            splice_descriptors.push(parseDTMFDescriptor(descriptor_tag, descriptor_length, identifier, reader));
        }
        else if (descriptor_tag === 0x02) {
            splice_descriptors.push(parseSegmentationDescriptor(descriptor_tag, descriptor_length, identifier, reader));
        }
        else if (descriptor_tag === 0x03) {
            splice_descriptors.push(parseTimeDescriptor(descriptor_tag, descriptor_length, identifier, reader));
        }
        else if (descriptor_tag === 0x04) {
            splice_descriptors.push(parseAudioDescriptor(descriptor_tag, descriptor_length, identifier, reader));
        }
        else {
            reader.readBits((descriptor_length - 4) * 8);
        }
        length += 2 + descriptor_length;
    }
    const E_CRC32 = encrypted_packet ? reader.readBits(32) : undefined;
    const CRC32 = reader.readBits(32);
    const detail = {
        table_id,
        section_syntax_indicator,
        private_indicator,
        section_length,
        protocol_version,
        encrypted_packet,
        encryption_algorithm,
        pts_adjustment,
        cw_index,
        tier,
        splice_command_length,
        splice_command_type,
        splice_command,
        descriptor_loop_length,
        splice_descriptors,
        E_CRC32,
        CRC32
    };
    if (splice_command_type === SCTE35CommandType.kSpliceInsert) {
        const spliceInsert = splice_command;
        if (spliceInsert.splice_event_cancel_indicator) {
            return {
                splice_command_type,
                detail,
                data
            };
        }
        else if (spliceInsert.program_splice_flag && !spliceInsert.splice_immediate_flag) {
            const auto_return = spliceInsert.duration_flag ? spliceInsert.break_duration.auto_return : undefined;
            const duraiton = spliceInsert.duration_flag ? spliceInsert.break_duration.duration / 90 : undefined;
            if (spliceInsert.splice_time.time_specified_flag) {
                return {
                    splice_command_type,
                    pts: (pts_adjustment + spliceInsert.splice_time.pts_time) % (2 ** 33),
                    auto_return,
                    duraiton,
                    detail,
                    data
                };
            }
            else {
                return {
                    splice_command_type,
                    auto_return,
                    duraiton,
                    detail,
                    data
                };
            }
        }
        else {
            const auto_return = spliceInsert.duration_flag ? spliceInsert.break_duration.auto_return : undefined;
            const duraiton = spliceInsert.duration_flag ? spliceInsert.break_duration.duration / 90 : undefined;
            return {
                splice_command_type,
                auto_return,
                duraiton,
                detail,
                data
            };
        }
    }
    else if (splice_command_type === SCTE35CommandType.kTimeSignal) {
        const timeSignal = splice_command;
        if (timeSignal.splice_time.time_specified_flag) {
            return {
                splice_command_type,
                pts: (pts_adjustment + timeSignal.splice_time.pts_time) % (2 ** 33),
                detail,
                data
            };
        }
        else {
            return {
                splice_command_type,
                detail,
                data
            };
        }
    }
    else {
        return {
            splice_command_type,
            detail,
            data
        };
    }
};
