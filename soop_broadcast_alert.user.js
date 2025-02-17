// ==UserScript==
// @name         SOOP 방송 알림
// @namespace    http://tampermonkey.net/
// @version      153
// @description  사용자가 등록한 아프리카TV 스트리머의 방송 상태를 확인하여 알림을 제공합니다.
// @author       che_dd_hyuji
// @match        *://play.sooplive.co.kr/*
// @match        *://www.sooplive.co.kr/*
// @match        *://vod.sooplive.co.kr/*
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      live.afreecatv.com
// ==/UserScript==

(async function() {
    'use strict';

// 알림 권한 요청
async function ensureNotificationPermission() {
    const hasRequested = await GM.getValue("hasRequestedNotificationPermission", false);
    if (hasRequested) return;
    Notification.requestPermission().then((permission) => {
        GM.setValue("hasRequestedNotificationPermission", true);
        console.log("Notification permission:", permission);
    });
}
await ensureNotificationPermission();

// 기본 상수 및 기본값
const BROADCASTER_LIST_KEY = 'broadcasterList';
const ALERT_INTERVAL_KEY = 'alertInterval';
const NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';
let alertInterval = await GM.getValue(ALERT_INTERVAL_KEY, 300000); // 기본 5분

// 전역 방송 상태 (broadcastState)를 저장하기 위한 키
const BROADCAST_STATE_KEY = "broadcastState";

// 스트리머 목록 저장 및 불러오기
async function getBroadcasterList() {
    return await GM.getValue(BROADCASTER_LIST_KEY, []);
}
async function setBroadcasterList(list) {
    await GM.setValue(BROADCASTER_LIST_KEY, list);
}

// 전역 broadcastState 업데이트 함수
async function updateBroadcastState(broadcasterId, isOnline) {
    let state = await GM.getValue(BROADCAST_STATE_KEY, {});
    state[broadcasterId] = isOnline;
    await GM.setValue(BROADCAST_STATE_KEY, state);
}
// 전역 broadcastState 조회 함수
async function getBroadcastState(broadcasterId) {
    let state = await GM.getValue(BROADCAST_STATE_KEY, {});
    return state[broadcasterId] || false;
}

// 스트리머 추가 함수
async function addBroadcaster() {
    let broadcasterId = prompt("알림을 받을 스트리머의 ID를 입력하세요:");
    if (broadcasterId) {
        let list = await getBroadcasterList();
        if (!list.includes(broadcasterId)) {
            list.push(broadcasterId);
            await setBroadcasterList(list);
            alert(`스트리머 "${broadcasterId}"이(가) 등록되었습니다.`);
        } else {
            alert("이미 등록된 스트리머입니다.");
        }
    }
}

// 스트리머 관리 함수
async function manageBroadcasters() {
    let list = await getBroadcasterList();
    if (list.length === 0) {
        alert("등록된 스트리머가 없습니다.");
        return;
    }
    let message = "등록된 스트리머 목록:\n" + list.join("\n") + "\n\n삭제할 스트리머의 ID를 입력하거나, 취소를 누르세요:";
    let toRemove = prompt(message);
    if (toRemove) {
        const newList = list.filter(id => id !== toRemove);
        await setBroadcasterList(newList);
        alert(`스트리머 "${toRemove}"의 등록이 해제되었습니다.`);
    }
}

// 방송 상태 로그 기록 함수
async function logBroadcastStatus(broadcasterId, status) {
    const logKey = `broadcastLog_${broadcasterId}`;
    let logs = await GM.getValue(logKey, []);
    logs.push({ timestamp: new Date().toISOString(), status });
    await GM.setValue(logKey, logs);
}

// AfreecaTV API를 호출하여 스트리머 방송 상태 조회 (스트리머 별명 포함)
async function fetchAfreecaLive(afreecaId) {
    return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
            method: "POST",
            url: "https://live.afreecatv.com/afreeca/player_live_api.php",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: "bid=" + encodeURIComponent(afreecaId),
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const chan = data.CHANNEL;
                    if (!chan) return reject("No channel for " + afreecaId);
                    if (chan.RESULT === 1) {
                        resolve({
                            online: true,
                            title: chan.TITLE || '',
                            nickname: chan.NICKNAME || '' // 스트리머 별명
                        });
                    } else {
                        resolve({ online: false });
                    }
                } catch (e) {
                    reject(e);
                }
            },
            onerror: function(err) {
                reject(err);
            }
        });
    });
}

// 방송 상태 확인 함수
async function checkBroadcasts() {
    let broadcasterList = await getBroadcasterList();
    if (!broadcasterList || broadcasterList.length === 0) {
        console.log("등록된 스트리머가 없습니다.");
        return;
    }
    
    const notificationsEnabled = await GM.getValue(NOTIFICATIONS_ENABLED_KEY, true);
    
    broadcasterList.forEach(async (broadcasterId) => {
        try {
            const info = await fetchAfreecaLive(broadcasterId);
            const currentBroadcastState = await getBroadcastState(broadcasterId);
            
            if (info.online && !currentBroadcastState) {
                // 방송 시작 알림 (알림 활성화 여부 확인)
                if (notificationsEnabled) {
                    GM_notification({
                        title: `방송 알림: ${broadcasterId} (${info.nickname})`,
                        text: `${info.nickname}님이 방송 중입니다!\n제목: ${info.title}`,
                        timeout: 5000,
                        onclick: () => window.focus()
                    });
                }
                // 전역 상태 업데이트 및 로그 기록
                await updateBroadcastState(broadcasterId, true);
                await logBroadcastStatus(broadcasterId, "online");
            } else if (!info.online && currentBroadcastState) {
                await updateBroadcastState(broadcasterId, false);
                await logBroadcastStatus(broadcasterId, "offline");
            }
        } catch (error) {
            console.error(`스트리머 ${broadcasterId} 정보 가져오기 실패:`, error);
        }
    });
}

// 메뉴 명령 추가
GM_registerMenuCommand("스트리머 추가", addBroadcaster);
GM_registerMenuCommand("등록된 스트리머 관리", manageBroadcasters);
GM_registerMenuCommand("알림 활성화/비활성화", async () => {
    const isEnabled = await GM.getValue(NOTIFICATIONS_ENABLED_KEY, true);
    const newStatus = !isEnabled;
    await GM.setValue(NOTIFICATIONS_ENABLED_KEY, newStatus);
    alert(`알림이 ${newStatus ? "활성화" : "비활성화"}되었습니다.`);
});
GM_registerMenuCommand("방송 체크 간격 수정", async () => {
    let currentMinutes = alertInterval / 60000;
    let newInterval = prompt("방송 체크 간격(분)을 입력하세요:", currentMinutes);
    if (newInterval) {
        newInterval = parseInt(newInterval, 10);
        if (!isNaN(newInterval) && newInterval > 0) {
            alertInterval = newInterval * 60000;
            GM.setValue(ALERT_INTERVAL_KEY, alertInterval);
            alert(`방송 체크 간격이 ${newInterval}분으로 변경되었습니다.`);
            clearInterval(broadcastIntervalId);
            broadcastIntervalId = setInterval(checkBroadcasts, alertInterval);
        } else {
            alert("올바른 값을 입력하세요.");
        }
    }
});
GM_registerMenuCommand("스트리머 검색", async () => {
    let query = prompt("검색할 스트리머 ID를 입력하세요:");
    if (query) {
        let list = await getBroadcasterList();
        if (list.includes(query)) {
            alert(`"${query}"은(는) 등록된 스트리머입니다.`);
        } else {
            alert(`"${query}"은(는) 등록되지 않은 스트리머입니다.`);
        }
    }
});

// 주기적으로 방송 상태 확인
let broadcastIntervalId = setInterval(checkBroadcasts, alertInterval);
