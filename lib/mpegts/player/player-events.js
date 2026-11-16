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
var PlayerEvents;
(function (PlayerEvents) {
    PlayerEvents["ERROR"] = "error";
    PlayerEvents["LOADING_COMPLETE"] = "loading_complete";
    PlayerEvents["RECOVERED_EARLY_EOF"] = "recovered_early_eof";
    PlayerEvents["MEDIA_INFO"] = "media_info";
    PlayerEvents["METADATA_ARRIVED"] = "metadata_arrived";
    PlayerEvents["SCRIPTDATA_ARRIVED"] = "scriptdata_arrived";
    PlayerEvents["TIMED_ID3_METADATA_ARRIVED"] = "timed_id3_metadata_arrived";
    PlayerEvents["PGS_SUBTITLE_ARRIVED"] = "pgs_subtitle_arrived";
    PlayerEvents["SYNCHRONOUS_KLV_METADATA_ARRIVED"] = "synchronous_klv_metadata_arrived";
    PlayerEvents["ASYNCHRONOUS_KLV_METADATA_ARRIVED"] = "asynchronous_klv_metadata_arrived";
    PlayerEvents["SMPTE2038_METADATA_ARRIVED"] = "smpte2038_metadata_arrived";
    PlayerEvents["SEI_ARRIVED"] = "sei_arrived";
    PlayerEvents["SCTE35_METADATA_ARRIVED"] = "scte35_metadata_arrived";
    PlayerEvents["PES_PRIVATE_DATA_DESCRIPTOR"] = "pes_private_data_descriptor";
    PlayerEvents["PES_PRIVATE_DATA_ARRIVED"] = "pes_private_data_arrived";
    PlayerEvents["STATISTICS_INFO"] = "statistics_info";
    PlayerEvents["DESTROYING"] = "destroying";
})(PlayerEvents || (PlayerEvents = {}));
;
export default PlayerEvents;
