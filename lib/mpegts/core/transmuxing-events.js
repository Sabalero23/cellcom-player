/*
 * Copyright (C) 2016 Bilibili. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var TransmuxingEvents;
(function (TransmuxingEvents) {
    TransmuxingEvents["IO_ERROR"] = "io_error";
    TransmuxingEvents["DEMUX_ERROR"] = "demux_error";
    TransmuxingEvents["INIT_SEGMENT"] = "init_segment";
    TransmuxingEvents["MEDIA_SEGMENT"] = "media_segment";
    TransmuxingEvents["LOADING_COMPLETE"] = "loading_complete";
    TransmuxingEvents["RECOVERED_EARLY_EOF"] = "recovered_early_eof";
    TransmuxingEvents["MEDIA_INFO"] = "media_info";
    TransmuxingEvents["METADATA_ARRIVED"] = "metadata_arrived";
    TransmuxingEvents["SCRIPTDATA_ARRIVED"] = "scriptdata_arrived";
    TransmuxingEvents["TIMED_ID3_METADATA_ARRIVED"] = "timed_id3_metadata_arrived";
    TransmuxingEvents["PGS_SUBTITLE_ARRIVED"] = "pgs_subtitle_arrived";
    TransmuxingEvents["SYNCHRONOUS_KLV_METADATA_ARRIVED"] = "synchronous_klv_metadata_arrived";
    TransmuxingEvents["ASYNCHRONOUS_KLV_METADATA_ARRIVED"] = "asynchronous_klv_metadata_arrived";
    TransmuxingEvents["SMPTE2038_METADATA_ARRIVED"] = "smpte2038_metadata_arrived";
    TransmuxingEvents["SEI_ARRIVED"] = "sei_arrived";
    TransmuxingEvents["SCTE35_METADATA_ARRIVED"] = "scte35_metadata_arrived";
    TransmuxingEvents["PES_PRIVATE_DATA_DESCRIPTOR"] = "pes_private_data_descriptor";
    TransmuxingEvents["PES_PRIVATE_DATA_ARRIVED"] = "pes_private_data_arrived";
    TransmuxingEvents["STATISTICS_INFO"] = "statistics_info";
    TransmuxingEvents["RECOMMEND_SEEKPOINT"] = "recommend_seekpoint";
})(TransmuxingEvents || (TransmuxingEvents = {}));
;
export default TransmuxingEvents;
