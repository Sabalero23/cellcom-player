/*
 * Copyright (C) 2023 zheng qian. All Rights Reserved.
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
import Log from '../utils/logger.js';
import LoggingControl from '../utils/logging-control.js';
import { IllegalStateException } from '../utils/exception.js';
import MSEEvents from '../core/mse-events.js';
import MSEController from '../core/mse-controller.js';
import Transmuxer from "../core/transmuxer.js";
import TransmuxingEvents from '../core/transmuxing-events.js';
import PlayerEvents from './player-events.js';
import { ErrorTypes, ErrorDetails } from './player-errors.js';
const PlayerEngineWorker = (self) => {
    const TAG = 'PlayerEngineWorker';
    const logcat_callback = onLogcatCallback;
    let media_data_source = null;
    let config = null;
    let mse_controller = null;
    let transmuxer = null;
    let mse_source_opened = false;
    let has_pending_load = false;
    let media_element_current_time = 0;
    let media_element_ready_state = 0;
    let destroyed = false;
    self.addEventListener('message', (e) => {
        if (destroyed) {
            return;
        }
        const command_packet = e.data;
        const cmd = command_packet.cmd;
        switch (cmd) {
            case 'logging_config': {
                const packet = command_packet;
                LoggingControl.applyConfig(packet.logging_config);
                if (packet.logging_config.enableCallback === true) {
                    LoggingControl.addLogListener(logcat_callback);
                }
                else {
                    LoggingControl.removeLogListener(logcat_callback);
                }
                break;
            }
            case 'init': {
                const packet = command_packet;
                media_data_source = packet.media_data_source;
                config = packet.config;
                break;
            }
            case 'destroy':
                destroy();
                break;
            case 'initialize_mse':
                initializeMSE();
                break;
            case 'shutdown_mse':
                shutdownMSE();
                break;
            case 'load':
                load();
                break;
            case 'unload':
                unload();
                break;
            case 'unbuffered_seek': {
                const packet = command_packet;
                mse_controller.flush();
                transmuxer.seek(packet.milliseconds);
                break;
            }
            case 'timeupdate': {
                const packet = command_packet;
                media_element_current_time = packet.current_time;
                break;
            }
            case 'readystatechange': {
                const packet = command_packet;
                media_element_ready_state = packet.ready_state;
                break;
            }
            case 'pause_transmuxer':
                transmuxer.pause();
                break;
            case 'resume_transmuxer':
                transmuxer.resume();
                break;
        }
    });
    function destroy() {
        if (transmuxer) {
            unload();
        }
        if (mse_controller) {
            shutdownMSE();
        }
        destroyed = true;
        self.postMessage({
            msg: 'destroyed',
        });
    }
    function initializeMSE() {
        Log.v(TAG, 'Initializing MediaSource in DedicatedWorker');
        mse_controller = new MSEController(config);
        mse_controller.on(MSEEvents.SOURCE_OPEN, onMSESourceOpen);
        mse_controller.on(MSEEvents.UPDATE_END, onMSEUpdateEnd);
        mse_controller.on(MSEEvents.BUFFER_FULL, onMSEBufferFull);
        mse_controller.on(MSEEvents.ERROR, onMSEError);
        mse_controller.initialize({
            getCurrentTime: () => media_element_current_time,
            getReadyState: () => media_element_ready_state,
        });
        const handle = mse_controller.getHandle();
        self.postMessage({
            msg: 'mse_init',
            handle: handle,
        }, [handle]);
    }
    function shutdownMSE() {
        if (mse_controller) {
            mse_controller.shutdown();
            mse_controller.destroy();
            mse_controller = null;
        }
    }
    function load() {
        if (media_data_source == null || config == null) {
            throw new IllegalStateException('Worker not initialized');
        }
        if (transmuxer) {
            throw new IllegalStateException('Transmuxer has been initialized');
        }
        if (has_pending_load) {
            return;
        }
        if (config.deferLoadAfterSourceOpen && !mse_source_opened) {
            has_pending_load = true;
            return;
        }
        transmuxer = new Transmuxer(media_data_source, config);
        transmuxer.on(TransmuxingEvents.INIT_SEGMENT, (type, is) => {
            mse_controller.appendInitSegment(is);
        });
        transmuxer.on(TransmuxingEvents.MEDIA_SEGMENT, (type, ms) => {
            mse_controller.appendMediaSegment(ms);
            self.postMessage({
                msg: 'buffered_position_changed',
                buffered_position_milliseconds: ms.info.endDts,
            });
        });
        transmuxer.on(TransmuxingEvents.LOADING_COMPLETE, () => {
            mse_controller.endOfStream();
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.LOADING_COMPLETE,
            });
        });
        transmuxer.on(TransmuxingEvents.RECOVERED_EARLY_EOF, () => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.RECOVERED_EARLY_EOF,
            });
        });
        transmuxer.on(TransmuxingEvents.IO_ERROR, (detail, info) => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.ERROR,
                error_type: ErrorTypes.NETWORK_ERROR,
                error_detail: detail,
                info: info,
            });
        });
        transmuxer.on(TransmuxingEvents.DEMUX_ERROR, (detail, info) => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.ERROR,
                error_type: ErrorTypes.MEDIA_ERROR,
                error_detail: detail,
                info: info,
            });
        });
        transmuxer.on(TransmuxingEvents.MEDIA_INFO, (mediaInfo) => {
            emitTransmuxingEventsInfo(TransmuxingEvents.MEDIA_INFO, mediaInfo);
        });
        transmuxer.on(TransmuxingEvents.STATISTICS_INFO, (statInfo) => {
            emitTransmuxingEventsInfo(TransmuxingEvents.STATISTICS_INFO, statInfo);
        });
        transmuxer.on(TransmuxingEvents.RECOMMEND_SEEKPOINT, (milliseconds) => {
            emitTransmuxingEventsRecommendSeekpoint(milliseconds);
        });
        transmuxer.on(TransmuxingEvents.METADATA_ARRIVED, (metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.METADATA_ARRIVED, metadata);
        });
        transmuxer.on(TransmuxingEvents.SCRIPTDATA_ARRIVED, (data) => {
            emitPlayerEventsExtraData(PlayerEvents.SCRIPTDATA_ARRIVED, data);
        });
        transmuxer.on(TransmuxingEvents.TIMED_ID3_METADATA_ARRIVED, (timed_id3_metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.TIMED_ID3_METADATA_ARRIVED, timed_id3_metadata);
        });
        transmuxer.on(TransmuxingEvents.PGS_SUBTITLE_ARRIVED, (pgs_data) => {
            emitPlayerEventsExtraData(PlayerEvents.PGS_SUBTITLE_ARRIVED, pgs_data);
        });
        transmuxer.on(TransmuxingEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, (synchronous_klv_metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, synchronous_klv_metadata);
        });
        transmuxer.on(TransmuxingEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, (asynchronous_klv_metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, asynchronous_klv_metadata);
        });
        transmuxer.on(TransmuxingEvents.SMPTE2038_METADATA_ARRIVED, (smpte2038_metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.SMPTE2038_METADATA_ARRIVED, smpte2038_metadata);
        });
        transmuxer.on(TransmuxingEvents.SEI_ARRIVED, (sei_data) => {
            emitPlayerEventsExtraData(PlayerEvents.SEI_ARRIVED, sei_data);
        });
        transmuxer.on(TransmuxingEvents.SCTE35_METADATA_ARRIVED, (scte35_metadata) => {
            emitPlayerEventsExtraData(PlayerEvents.SCTE35_METADATA_ARRIVED, scte35_metadata);
        });
        transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_DESCRIPTOR, (descriptor) => {
            emitPlayerEventsExtraData(PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR, descriptor);
        });
        transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_ARRIVED, (private_data) => {
            emitPlayerEventsExtraData(PlayerEvents.PES_PRIVATE_DATA_ARRIVED, private_data);
        });
        transmuxer.open();
    }
    function unload() {
        if (mse_controller) {
            mse_controller.flush();
        }
        if (transmuxer) {
            transmuxer.close();
            transmuxer.destroy();
            transmuxer = null;
        }
    }
    function onMSESourceOpen() {
        mse_source_opened = true;
        if (has_pending_load) {
            has_pending_load = false;
            load();
        }
    }
    function onMSEUpdateEnd() {
        self.postMessage({
            msg: 'mse_event',
            event: MSEEvents.UPDATE_END,
        });
    }
    function onMSEBufferFull() {
        Log.v(TAG, 'MSE SourceBuffer is full, report to main thread');
        self.postMessage({
            msg: 'mse_event',
            event: MSEEvents.BUFFER_FULL,
        });
    }
    function onMSEError(info) {
        self.postMessage({
            msg: 'player_event',
            event: PlayerEvents.ERROR,
            error_type: ErrorTypes.MEDIA_ERROR,
            error_detail: ErrorDetails.MEDIA_MSE_ERROR,
            info: info,
        });
    }
    function emitTransmuxingEventsRecommendSeekpoint(milliseconds) {
        self.postMessage({
            msg: 'transmuxing_event',
            event: TransmuxingEvents.RECOMMEND_SEEKPOINT,
            milliseconds: milliseconds,
        });
    }
    function emitTransmuxingEventsInfo(event, info) {
        self.postMessage({
            msg: 'transmuxing_event',
            event: event,
            info: info,
        });
    }
    function emitPlayerEventsExtraData(event, extraData) {
        self.postMessage({
            msg: 'player_event',
            event: event,
            extraData: extraData,
        });
    }
    function onLogcatCallback(type, str) {
        self.postMessage({
            msg: 'logcat_callback',
            type: type,
            logcat: str,
        });
    }
};
export default PlayerEngineWorker;
