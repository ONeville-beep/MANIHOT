/**
 * @file bluetooth.js
 * @description Modul komunikasi Web Bluetooth API (BLE GATT) untuk mikrokontroler ESP32.
 * Terpisah sepenuhnya dari manipulasi DOM dan generator simulasi.
 *
 * Catatan Protokol Payload Contoh (Disesuaikan dengan firmware ESP32 final):
 * JSON UTF-8 per notifikasi GATT:
 * {"ts":1700000000000,"t_mat":40.15,"t_skin":39.20,"lux":840.5}
 */

export class ManihotBleClient {
  /**
   * @param {Object} handlers Callback { onSampleReceived, onStatusChange, onLog }
   */
  constructor(handlers = {}) {
    this.onSampleReceived = handlers.onSampleReceived || (() => {});
    this.onStatusChange = handlers.onStatusChange || (() => {});
    this.onLog = handlers.onLog || (() => {});

    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.isConnected = false;
    this.receiveBuffer = '';

    this._boundHandleDisconnect = this._handleDisconnection.bind(this);
    this._boundHandleNotification = this._handleCharacteristicValueChanged.bind(this);
  }

  /**
   * Memeriksa ketersediaan Web Bluetooth API dan Secure Context pada browser.
   * @returns {{supported: boolean, reason: string}}
   */
  checkAvailability() {
    if (!window.isSecureContext) {
      return {
        supported: false,
        reason: 'Web Bluetooth membutuhkan Secure Context (HTTPS atau http://localhost / 127.0.0.1).'
      };
    }
    if (!navigator.bluetooth) {
      return {
        supported: false,
        reason: 'Browser ini tidak mendukung Web Bluetooth API. Gunakan Google Chrome atau Microsoft Edge pada Desktop/Android.'
      };
    }
    return { supported: true, reason: 'Web Bluetooth API tersedia.' };
  }

  /**
   * Meminta izin pengguna memilih perangkat BLE ESP32 dan membuka koneksi GATT.
   * @param {Object} config Konfigurasi aktif berisi UUID Service & Characteristic
   * @returns {Promise<boolean>}
   */
  async connect(config) {
    const availability = this.checkAvailability();
    if (!availability.supported) {
      this.onLog('ERROR', 'BLE_SUPPORT', availability.reason);
      this.onStatusChange('ERROR', null, availability.reason);
      return false;
    }

    const serviceUuid = String(config.bleServiceUuid || '').trim();
    const charUuid = String(config.bleCharacteristicUuid || '').trim();
    const namePrefix = String(config.bleDeviceNamePrefix || 'MANIHOT').trim();

    if (!serviceUuid || !charUuid) {
      const msg = 'UUID Service atau Characteristic BLE belum dikonfigurasi.';
      this.onLog('ERROR', 'BLE_CONFIG', msg);
      this.onStatusChange('ERROR', null, msg);
      return false;
    }

    try {
      this.onStatusChange('CONNECTING', null, 'Menunggu pemilihan perangkat BLE oleh pengguna...');
      this.onLog('INFO', 'BLE_CONNECT', `Meminta pemilihan perangkat BLE (Prefix: "${namePrefix}", Service: ${serviceUuid})...`);

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix }],
        optionalServices: [serviceUuid]
      });

      const deviceName = this.device.name || 'ESP32-MANIHOT (Tanpa Nama)';
      this.device.addEventListener('gattserverdisconnected', this._boundHandleDisconnect);

      this.onLog('INFO', 'BLE_CONNECT', `Perangkat "${deviceName}" dipilih. Menghubungkan ke server GATT...`);
      this.server = await this.device.gatt.connect();

      this.onLog('INFO', 'BLE_GATT', `Membaca Primary Service (${serviceUuid})...`);
      this.service = await this.server.getPrimaryService(serviceUuid);

      this.onLog('INFO', 'BLE_GATT', `Membaca Characteristic (${charUuid})...`);
      this.characteristic = await this.service.getCharacteristic(charUuid);

      await this.characteristic.startNotifications();
      this.characteristic.addEventListener('characteristicvaluechanged', this._boundHandleNotification);

      this.isConnected = true;
      this.receiveBuffer = '';
      this.onLog('INFO', 'BLE_CONNECTED', `Terhubung ke "${deviceName}". Menunggu paket telemetri dari ESP32.`);
      this.onStatusChange('CONNECTED', deviceName, 'Terhubung ke perangkat BLE.');
      return true;
    } catch (err) {
      this._cleanupListeners();
      this.isConnected = false;

      let readableError = err && err.message ? err.message : 'Koneksi BLE gagal.';
      if (err && err.name === 'NotFoundError') {
        readableError = 'Pemilihan perangkat BLE dibatalkan oleh pengguna atau perangkat ESP32 tidak ditemukan.';
      } else if (err && err.name === 'SecurityError') {
        readableError = 'Izin akses Web Bluetooth ditolak oleh pengaturan keamanan browser.';
      } else if (err && err.name === 'NetworkError') {
        readableError = 'Gagal terhubung ke server GATT ESP32 (perangkat di luar jangkauan atau sedang terhubung ke host lain).';
      }

      this.onLog('ERROR', 'BLE_ERROR', readableError);
      this.onStatusChange('ERROR', null, readableError);
      return false;
    }
  }

  /**
   * Memutuskan koneksi BLE secara sengaja oleh pengguna.
   */
  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.onLog('INFO', 'BLE_DISCONNECT', `Memutuskan koneksi dari "${this.device.name || 'perangkat BLE'}"...`);
      this.device.gatt.disconnect();
    } else {
      this._handleDisconnection();
    }
  }

  _handleDisconnection() {
    const devName = this.device ? this.device.name : 'Perangkat BLE';
    this._cleanupListeners();
    this.isConnected = false;
    this.onLog('WARN', 'BLE_DISCONNECTED', `Koneksi BLE dengan "${devName}" terputus. Data ditandai tidak aktif.`);
    this.onStatusChange('DISCONNECTED', null, 'Koneksi perangkat BLE terputus.');
  }

  _cleanupListeners() {
    try {
      if (this.characteristic) {
        this.characteristic.removeEventListener('characteristicvaluechanged', this._boundHandleNotification);
      }
      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this._boundHandleDisconnect);
      }
    } catch (err) {
      // Abaikan error pelepasan listener
    }
    this.characteristic = null;
    this.service = null;
    this.server = null;
  }

  /**
   * Menerima byte DataView dari GATT notification dan melakukan parsing payload JSON.
   */
  _handleCharacteristicValueChanged(event) {
    try {
      const valueDataView = event.target.value;
      const decoder = new TextDecoder('utf-8');
      const chunk = decoder.decode(valueDataView);

      this.receiveBuffer += chunk;

      // Apabila payload dipisahkan baris baru (\n) atau berupa objek JSON utuh
      if (this.receiveBuffer.includes('\n')) {
        const lines = this.receiveBuffer.split('\n');
        this.receiveBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this._parseAndEmitPayload(trimmed);
          }
        }
      } else {
        const trimmed = this.receiveBuffer.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          this.receiveBuffer = '';
          this._parseAndEmitPayload(trimmed);
        } else if (this.receiveBuffer.length > 1024) {
          this.receiveBuffer = '';
          this.onLog('ERROR', 'BLE_PARSE', 'Buffer BLE melebihi 1024 byte tanpa pembatas JSON valid. Buffer direset.');
        }
      }
    } catch (err) {
      this.onLog('ERROR', 'BLE_READ_ERR', `Kesalahan pembacaan karakteristik GATT: ${err.message}`);
    }
  }

  /**
   * Mengurai string JSON dari ESP32 menjadi struktur telemetri internal.
   * Mendukung kunci pendek ("t_mat", "t_skin", "lux", "ts") maupun kunci lengkap.
   * @param {string} rawString
   */
  _parseAndEmitPayload(rawString) {
    try {
      const parsed = JSON.parse(rawString);

      const tMat = parsed.t_mat !== undefined ? parsed.t_mat : parsed.tempMaterial;
      const tSkin = parsed.t_skin !== undefined ? parsed.t_skin : parsed.tempSkin;
      const lux = parsed.lux !== undefined ? parsed.lux : parsed.illuminance;

      if (tMat === undefined || tSkin === undefined || lux === undefined) {
        this.onLog('ERROR', 'BLE_PAYLOAD', `Field wajib tidak lengkap pada JSON ESP32: ${rawString}`);
        return;
      }

      // Gunakan timestamp perangkat jika berupa epoch ms valid, atau gunakan waktu penerimaan browser
      const rawTs = Number(parsed.ts || parsed.timestamp);
      const timestamp = Number.isFinite(rawTs) && rawTs > 1600000000000 ? rawTs : Date.now();

      this.onSampleReceived({
        timestamp,
        tempMaterial: Number(tMat),
        tempSkin: Number(tSkin),
        illuminance: Number(lux),
        sourceMode: 'HARDWARE',
        isSimulated: false
      });
    } catch (err) {
      this.onLog('ERROR', 'BLE_JSON_FAIL', `Gagal mengurai JSON dari ESP32 ("${rawString.slice(0, 80)}"): ${err.message}`);
    }
  }
}