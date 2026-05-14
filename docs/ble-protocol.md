# PostureIQ BLE Protocol Specification

**대상**: 펌웨어 개발자 (아두이노/ESP32 측), 앱 개발자 (Capacitor 측)
**버전**: 0.1 (초안 — 펌웨어 1차 동작 후 확정)
**최종 수정**: 2026-05-13

---

## 0. 합의 사항 (먼저 결정)

펌웨어 시작 전에 팀에서 다음 결정사항을 확정하고 이 문서에 반영하세요:

| 항목 | 기본값(권장) | 확정값 |
|---|---|---|
| MCU/BLE 모듈 | ESP32-WROOM-32 (BLE 내장) | TBD |
| 인솔 구성 | 좌·우 각각 독립 BLE 디바이스 (2개 페어링) | TBD |
| 압력 센서 종류 | FSR-402 또는 Velostat | TBD |
| 발당 센서 개수 | **4개** (뒤꿈치/아치/볼/발가락) | TBD |
| ADC 해상도 | 10-bit (0~1023) — 12-bit 도 OK | TBD |
| 샘플링 주기 | 100ms (10 Hz) | TBD |
| 배터리 | 3.7V Li-Po 500mAh ~ 1000mAh | TBD |

---

## 1. 디바이스 발견 (Discovery)

### 1.1 Advertising

좌·우 인솔은 각각 독립 BLE 페리페럴로 동작.

| 인솔 | Local Name (광고 이름) |
|---|---|
| 왼발 | `PostureIQ-L` |
| 오른발 | `PostureIQ-R` |

**Advertising 데이터에 포함**:
- Local Name (위 형식)
- Service UUID (아래 1.2)
- TX Power (선택)
- Manufacturer Data: `[0x50, 0x49, foot]` — `'P'`, `'I'`, foot(`L`=0x4C, `R`=0x52)

**광고 주기**: 100~200ms (페어링 중일 때만)
**페어링 후**: 광고 중단

### 1.2 Service UUID

본 프로젝트 전용 128-bit UUID:

```
PostureIQ Pressure Service:  0xA0F9 (Custom 16-bit, vendor-allocated)
                             또는 풀 UUID: 0000a0f9-0000-1000-8000-00805f9b34fb
```

> 캡스톤이라 vendor UUID 등록은 불필요. 16-bit `0xA0F9` 사용해도 동작.

---

## 2. GATT 구조

```
PostureIQ Pressure Service (0xA0F9)
├── pressure_data        (Notify)     — 실시간 압력 데이터
├── battery_level        (Read+Notify) — 표준 0x2A19
├── device_info          (Read)        — 펌웨어 정보 + 발 식별
├── calibrate            (Write)       — 캘리브레이션 명령
└── sampling_rate        (Read+Write)  — 샘플링 주기 변경
```

### 2.1 pressure_data (Notify)

**UUID**: `0xA0F1` (Custom)
**Properties**: NOTIFY only
**Packet 크기**: 8 bytes
**Frequency**: 10 Hz (100ms 주기)

**Packet 포맷** (Little-Endian uint16):

| Offset | Bytes | Name | Range | 설명 |
|---|---|---|---|---|
| 0~1 | 2 | sensor_heel | 0~1023 | 뒤꿈치 (Heel) |
| 2~3 | 2 | sensor_arch | 0~1023 | 아치 (Midfoot) |
| 4~5 | 2 | sensor_ball | 0~1023 | 발볼 (Forefoot, 1st metatarsal head) |
| 6~7 | 2 | sensor_toe | 0~1023 | 발가락 (Hallux/Big toe) |

**예시 패킷** (왼발 뒤꿈치 870, 아치 312, 볼 580, 발가락 220):
```
[0x66 0x03  0x38 0x01  0x44 0x02  0xDC 0x00]
   870        312        580        220
```

### 2.2 battery_level (Read + Notify)

**UUID**: `0x2A19` (표준 Battery Service Characteristic)
**Properties**: READ, NOTIFY
**Packet 크기**: 1 byte
**Value**: 0~100 (%)

배터리 15% 이하로 떨어지면 NOTIFY로 알림 (선택).

### 2.3 device_info (Read)

**UUID**: `0xA0F2` (Custom)
**Properties**: READ
**Packet 크기**: 16 bytes (고정)

| Offset | Bytes | Name | 예시 |
|---|---|---|---|
| 0 | 1 | foot_side | `0x4C` ('L') or `0x52` ('R') |
| 1 | 1 | firmware_major | `0x01` |
| 2 | 1 | firmware_minor | `0x00` |
| 3 | 1 | firmware_patch | `0x00` |
| 4~7 | 4 | mac_lower | MAC 주소 하위 4 byte |
| 8~15 | 8 | reserved | 0으로 채움 |

### 2.4 calibrate (Write)

**UUID**: `0xA0F3` (Custom)
**Properties**: WRITE
**Packet 크기**: 1 byte

| Value | 의미 |
|---|---|
| `0x00` | 캘리브레이션 취소 |
| `0x01` | 영점 (Tare) 캘리브레이션 시작 — 5초간 평균값을 baseline으로 저장 |
| `0x02` | 최대값 캘리브레이션 — 사용자가 최대 압력 인가 시점 기준 |

캘리브레이션 완료 시 `pressure_data` notification에 임시 플래그를 띄우는 대신, 단순히 다음 notification부터 정상 값 송출.

### 2.5 sampling_rate (Read + Write)

**UUID**: `0xA0F4` (Custom)
**Properties**: READ, WRITE
**Packet 크기**: 1 byte
**Value**: Hz (1~100)

기본값 10. 앱에서 5/10/20/50 등으로 변경 가능. 배터리 절약 시 1 Hz, 고정밀 시 50 Hz.

---

## 3. 데이터 해석 (앱 측)

### 3.1 원본 → 정규화

펌웨어가 보내는 `0~1023` ADC 값을 앱은 **0~100% 정규화 압력**으로 변환:

```js
function normalize(raw) {
  // 캘리브레이션 baseline 제거 (옵션)
  const adjusted = Math.max(0, raw - baseline);
  // 0~100% 클램핑
  return Math.min(100, (adjusted / 1023) * 100);
}
```

### 3.2 좌우 밸런스 계산

```js
const leftTotal  = L.heel + L.arch + L.ball + L.toe;
const rightTotal = R.heel + R.arch + R.ball + R.toe;
const total = leftTotal + rightTotal;

const leftPct  = (leftTotal  / total) * 100;
const rightPct = (rightTotal / total) * 100;
```

### 3.3 이벤트 트리거

- 좌우 차이가 **15% 이상 + 10초 이상 지속** → "불균형 알림"
- 한쪽 발의 한 센서가 다른 센서보다 **3배 이상** → "압력 집중"
- 캘리브레이션 baseline 대비 모든 센서 0에 가까움 → "발 떨어짐 감지" (insole 벗었을 가능성)

---

## 4. 펌웨어 의사 코드 (ESP32 BLE 기준)

팀원에게 참고용. 실제 코드는 BLE 라이브러리(`NimBLE-Arduino` 등) 사용 권장.

```cpp
// setup()
BLEDevice::init("PostureIQ-L");  // 또는 -R
BLEServer* server = BLEDevice::createServer();
BLEService* svc = server->createService("0000a0f9-0000-1000-8000-00805f9b34fb");

// pressure_data characteristic
pressureChar = svc->createCharacteristic(
  "0000a0f1-0000-1000-8000-00805f9b34fb",
  BLECharacteristic::PROPERTY_NOTIFY);
pressureChar->addDescriptor(new BLE2902());

// loop()
uint16_t heel = analogRead(PIN_HEEL);
uint16_t arch = analogRead(PIN_ARCH);
uint16_t ball = analogRead(PIN_BALL);
uint16_t toe  = analogRead(PIN_TOE);

uint8_t packet[8];
memcpy(packet + 0, &heel, 2);
memcpy(packet + 2, &arch, 2);
memcpy(packet + 4, &ball, 2);
memcpy(packet + 6, &toe,  2);

pressureChar->setValue(packet, 8);
pressureChar->notify();
delay(100);  // 10 Hz
```

---

## 5. 테스트 도구

펌웨어가 위 사양대로 동작하는지 **앱 없이도** 검증 가능:

- **nRF Connect** (안드로이드/iOS 무료 앱)
  - `PostureIQ-L` 검색 → 연결 → pressure_data Notify 구독 → 16진수 패킷 확인
- **Bluefruit Connect** (Adafruit, 비슷한 기능)
- **bleak** (Python 라이브러리, PC에서 테스트)

펌웨어 1차 완성 시 위 도구로 검증 → 검증 통과 후 앱 연결.

---

## 6. 통합 체크리스트

펌웨어 ↔ 앱 통합 시 확인:

- [ ] Local Name이 정확히 `PostureIQ-L` / `PostureIQ-R`
- [ ] Service UUID `0xA0F9` advertising에 포함
- [ ] pressure_data 패킷 8 bytes, Little-Endian uint16
- [ ] Notify 주기 100ms (±10ms 허용)
- [ ] battery_level 1 byte, 0~100
- [ ] device_info의 foot_side가 'L'/'R' 정확
- [ ] calibrate 명령 수신 후 baseline 갱신 확인
- [ ] 연결 끊김 시 자동 재연결 가능 (advertising 재개)

---

## 7. 변경 이력

| 버전 | 날짜 | 변경 사항 |
|---|---|---|
| 0.1 | 2026-05-13 | 초안 작성 |
