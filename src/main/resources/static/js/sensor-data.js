/* ──────────────────────────────────────────────────────────────
 * PostureIQ — Sensor data source abstraction
 *
 * 두 가지 구현체를 같은 인터페이스로 제공:
 *   - MockDataSource:      가짜 데이터로 UI 동작 검증 / 시연
 *   - BluetoothDataSource: 실제 BLE 인솔 연결 (펌웨어 준비 후 구현)
 *
 * 페이지에서 사용:
 *   const source = new PostureIQ.MockDataSource();
 *   source.on('reading', (r) => updateUI(r));
 *   source.start();
 *
 * Reading 이벤트 페이로드 (docs/ble-protocol.md 참고):
 *   {
 *     timestamp: ms,
 *     left:  { heel, arch, ball, toe, battery },  // raw 0~1023
 *     right: { heel, arch, ball, toe, battery },
 *     balance: { leftPct, rightPct },             // 0~100
 *   }
 * ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── 공통 이벤트 디스패처 ────────────────────────────────
  class EventEmitter {
    constructor() { this._listeners = {}; }
    on(event, cb)  { (this._listeners[event] ||= []).push(cb); return this; }
    off(event, cb) { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== cb); }
    emit(event, payload) { (this._listeners[event] || []).forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } }); }
  }

  // ── 헬퍼: 정규화 / 합산 ────────────────────────────────
  function sumFoot(f) { return f.heel + f.arch + f.ball + f.toe; }
  function computeBalance(left, right) {
    const lSum = sumFoot(left);
    const rSum = sumFoot(right);
    const total = lSum + rSum;
    if (total === 0) return { leftPct: 50, rightPct: 50 };
    return {
      leftPct:  (lSum / total) * 100,
      rightPct: (rSum / total) * 100,
    };
  }

  // ── MockDataSource ────────────────────────────────────
  // 시뮬레이션:
  //   - 자연스러운 압력 베이스라인 (뒤꿈치 > 볼 > 아치 > 발가락)
  //   - 노이즈 ±5%
  //   - 주기적 불균형 에피소드 (15초간 우측 쏠림, 15초 회복)
  class MockDataSource extends EventEmitter {
    constructor(opts = {}) {
      super();
      this.intervalMs = opts.intervalMs || 100;      // 10 Hz default
      this.imbalanceCycleMs = opts.imbalanceCycleMs || 30000;  // 30s 주기
      this._timer = null;
      this._startTime = 0;
      this._battery = { L: 78, R: 52 };
    }

    start() {
      if (this._timer) return;
      this._startTime = Date.now();
      this.emit('connected', { devices: ['PostureIQ-L (mock)', 'PostureIQ-R (mock)'] });
      this._timer = setInterval(() => this._tick(), this.intervalMs);
    }

    stop() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this.emit('disconnected');
    }

    _tick() {
      const t = (Date.now() - this._startTime) / 1000;  // seconds since start
      // 불균형 에피소드: 0~15초 균형, 15~30초 우측 쏠림
      const cyclePhase = (t * 1000) % this.imbalanceCycleMs;
      const imbalanceFactor = cyclePhase > this.imbalanceCycleMs / 2 ? 0.18 : 0;  // 우측 18% 증가

      const baseline = { heel: 380, arch: 180, ball: 280, toe: 120 };
      const noise = () => (Math.random() - 0.5) * 60;

      const left = {
        heel: Math.round(baseline.heel + noise()),
        arch: Math.round(baseline.arch + noise()),
        ball: Math.round(baseline.ball + noise()),
        toe:  Math.round(baseline.toe + noise()),
        battery: this._battery.L,
      };
      const right = {
        heel: Math.round(baseline.heel * (1 + imbalanceFactor) + noise()),
        arch: Math.round(baseline.arch * (1 + imbalanceFactor) + noise()),
        ball: Math.round(baseline.ball * (1 + imbalanceFactor) + noise()),
        toe:  Math.round(baseline.toe  * (1 + imbalanceFactor) + noise()),
        battery: this._battery.R,
      };

      // 배터리 천천히 감소 (시연용)
      if (Math.random() < 0.0005) this._battery.L = Math.max(0, this._battery.L - 1);
      if (Math.random() < 0.0008) this._battery.R = Math.max(0, this._battery.R - 1);

      const balance = computeBalance(left, right);
      this.emit('reading', {
        timestamp: Date.now(),
        left, right, balance,
      });
    }
  }

  // ── BluetoothDataSource (TODO: 펌웨어 준비 후 구현) ───
  //
  // 실제 구현 시 사용할 플러그인: @capacitor-community/bluetooth-le
  //   npm install @capacitor-community/bluetooth-le
  //   npx cap sync android
  //
  // docs/ble-protocol.md 의 UUID 와 일치해야 함:
  //   Service:           0xA0F9
  //   pressure_data:     0xA0F1 (Notify, 8 bytes)
  //   battery_level:     0x2A19 (Read+Notify, 1 byte)
  //   calibrate:         0xA0F3 (Write, 1 byte)
  //
  class BluetoothDataSource extends EventEmitter {
    constructor() {
      super();
      throw new Error('BluetoothDataSource not implemented yet — see docs/ble-protocol.md');
    }
    // start() { /* await BleClient.initialize(); ... scan ... connect ... subscribe ... */ }
    // stop()  { /* await BleClient.disconnect(...) */ }
    // calibrate(mode) { /* await BleClient.write(deviceId, SERVICE_UUID, CALIBRATE_UUID, ...) */ }
  }

  // 전역으로 노출 (HTML 페이지에서 사용)
  window.PostureIQ = window.PostureIQ || {};
  window.PostureIQ.MockDataSource = MockDataSource;
  window.PostureIQ.BluetoothDataSource = BluetoothDataSource;
  window.PostureIQ.computeBalance = computeBalance;
  window.PostureIQ.sumFoot = sumFoot;
})();
