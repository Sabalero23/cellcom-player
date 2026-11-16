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
var MSEEvents;
(function (MSEEvents) {
    MSEEvents["ERROR"] = "error";
    MSEEvents["SOURCE_OPEN"] = "source_open";
    MSEEvents["UPDATE_END"] = "update_end";
    MSEEvents["BUFFER_FULL"] = "buffer_full";
    MSEEvents["START_STREAMING"] = "start_streaming";
    MSEEvents["END_STREAMING"] = "end_streaming";
})(MSEEvents || (MSEEvents = {}));
;
export default MSEEvents;
