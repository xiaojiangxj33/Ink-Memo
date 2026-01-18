/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EpdCmd, BluetoothStatus, CanvasSize } from './types';
import { processImageData } from './dithering';

// 画布尺寸定义
export const canvasSizes: CanvasSize[] = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_212_104', width: 212, height: 104 },
  { name: '2.13_250_122', width: 250, height: 122 },
  { name: '2.66_296_152', width: 296, height: 152 },
  { name: '2.9_296_128', width: 296, height: 128 },
  { name: '2.9_384_168', width: 384, height: 168 },
  { name: '3.5_384_184', width: 384, height: 184 },
  { name: '3.7_416_240', width: 416, height: 240 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4E_600_400', width: 600, height: 400 },
  { name: '7.3E6', width: 480, height: 800 }
];

// 蓝牙相关变量
let bleDevice: BluetoothDevice | null = null;
let gattServer: BluetoothRemoteGATTServer | null = null;
let epdService: BluetoothRemoteGATTService | null = null;
let epdCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
let startTime: number = 0;
let msgIndex: number = 0;
let appVersion: number = 0;
let textDecoder: TextDecoder | null = null;

// 日志回调类型
type LogCallback = (message: string, action?: string) => void;
let logCallback: LogCallback | null = null;

// 进度回调类型
type ProgressCallback = (progress: number) => void;
let progressCallback: ProgressCallback | null = null;

/**
 * 设置日志回调
 */
export function setLogCallback(callback: LogCallback): void {
  logCallback = callback;
}

/**
 * 设置进度回调
 */
export function setProgressCallback(callback: ProgressCallback): void {
  progressCallback = callback;
}

/**
 * 日志记录
 */
function addLog(message: string, action: string = ''): void {
  if (logCallback) {
    logCallback(message, action);
  } else {
    console.log(`${action ? `${action} ` : ''}${message}`);
  }
}

/**
 * 重置蓝牙相关变量
 */
export function resetVariables(): void {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  addLog('变量已重置');
}

/**
 * 将十六进制字符串转换为Uint8Array
 */
export function hex2bytes(hex: string): Uint8Array {
  const bytes = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }
  return new Uint8Array(bytes);
}

/**
 * 将Uint8Array转换为十六进制字符串
 */
export function bytes2hex(data: Uint8Array | number[]): string {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

/**
 * 将整数转换为十六进制字符串
 */
export function intToHex(intIn: number): string {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4);
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

/**
 * 向蓝牙设备写入数据
 */
export async function write(cmd: number, data?: string | Uint8Array | number[], withResponse: boolean = true): Promise<boolean> {
  if (!epdCharacteristic) {
    addLog("向设备写入数据失败：服务不可用，请检查蓝牙连接");
    return false;
  }
  
  // 检查设备连接状态
  if (!gattServer || !gattServer.connected) {
    addLog("向设备写入数据失败：设备未连接");
    return false;
  }
  
  let payload = [cmd];
  if (data) {
    if (typeof data === 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data);
  }
  
  // 隐藏图片数据的详细日志，只记录命令类型
  if (cmd === EpdCmd.WRITE_IMG) {
    // 只记录写入图片数据的命令类型，不显示详细数据
    addLog("发送图片数据块", '⇑');
  } else {
    // 其他命令正常记录
    addLog(bytes2hex(payload), '⇑');
  }
  
  try {
    if (withResponse) {
      await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    } else {
      await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
    }
    return true;
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message) {
      if (e.message.includes('disconnected') || e.message.includes('Disconnected')) {
        addLog("向设备写入数据失败：设备已断开连接");
      } else {
        addLog(`向设备写入数据失败：${e.message}`);
      }
    } else {
      addLog("向设备写入数据失败：未知错误");
    }
    return false;
  }
}

/**
 * 写入图像数据
 */
export async function writeImage(data: Uint8Array, step: 'bw' | 'color' = 'bw'): Promise<void> {
  const chunkSize = parseInt(document.getElementById('mtusize')?.value || '20') - 2;
  const interleavedCount = parseInt(document.getElementById('interleavedcount')?.value || '50');
  const totalBytes = data.length;
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  let chunkIdx = 0;
  let noReplyCount = interleavedCount;
  let bytesSent = 0;

  for (let i = 0; i < data.length; i += chunkSize) {
    // 计算进度百分比
    const currentChunkSize = Math.min(chunkSize, data.length - i);
    bytesSent += currentChunkSize;
    const progress = Math.round((bytesSent / totalBytes) * 100);
    
    // 显示友好的进度信息，使用进度条样式
    const progressBar = '//////////'.substring(0, Math.round((progress / 10))) + '.........'.substring(0, 10 - Math.round((progress / 10)));
    
    let currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${step === 'bw' ? '黑白' : '颜色'}数据 | ${progressBar} ${progress}% | 总用时: ${currentTime.toFixed(1)}s`);
    
    // 调用进度回调
    if (progressCallback) {
      progressCallback(progress);
    }
    
    const payload = [
      (step === 'bw' ? 0x0F : 0x00) | (i === 0 ? 0x00 : 0xF0),
      ...data.slice(i, i + chunkSize),
    ];
    if (noReplyCount > 0) {
      await write(EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      await write(EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = interleavedCount;
    }
    chunkIdx++;
  }
}

/**
 * 设置驱动
 */
export async function setDriver(): Promise<void> {
  const epdpins = document.getElementById("epdpins") as HTMLInputElement;
  const epddriver = document.getElementById("epddriver") as HTMLSelectElement;
  await write(EpdCmd.SET_PINS, epdpins.value);
  await write(EpdCmd.INIT, epddriver.value);
}

/**
 * 同步时间
 */
export async function syncTime(mode: number): Promise<void> {
  // 检查设备连接状态
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    addLog("同步时间失败：设备未连接");
    return;
  }
  
  if (mode === 2) {
    if (!confirm('提醒：时钟模式目前使用全刷实现，此功能目前多用于修复老化屏残影问题，不建议长期开启，是否继续？')) return;
  }
  
  addLog(`开始同步时间，模式: ${mode}`);
  
  const timestamp = new Date().getTime() / 1000;
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    -(new Date().getTimezoneOffset() / 60),
    mode
  ]);
  
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  } else {
    addLog("时间同步失败：发送命令失败");
  }
}

/**
 * 清除屏幕
 */
export async function clearScreen(): Promise<void> {
  // 检查设备连接状态
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    addLog("清除屏幕失败：设备未连接");
    return;
  }
  
  if (confirm('确认清除屏幕内容?')) {
    addLog("开始清除屏幕...");
    
    if (await write(EpdCmd.CLEAR)) {
      addLog("清屏指令已发送！");
      addLog("屏幕刷新完成前请不要操作。");
    } else {
      addLog("清除屏幕失败：发送命令失败");
    }
  } else {
    addLog("清除屏幕操作已取消");
  }
}

/**
 * 发送命令
 */
export async function sendcmd(): Promise<void> {
  // 检查设备连接状态
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    addLog("发送命令失败：设备未连接");
    return;
  }
  
  const cmdTXT = (document.getElementById('cmdTXT') as HTMLInputElement).value;
  if (cmdTXT === '') {
    addLog("发送命令失败：命令不能为空");
    return;
  }
  
  addLog(`开始发送自定义命令: ${cmdTXT}`);
  
  try {
    const bytes = hex2bytes(cmdTXT);
    if (await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null)) {
      addLog(`命令发送成功: ${cmdTXT}`);
    } else {
      addLog(`命令发送失败: ${cmdTXT}`);
    }
  } catch (error) {
    console.error('发送命令失败:', error);
    addLog(`发送命令失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 转换UC8159格式
 */
export function convertUC8159(blackWhiteData: Uint8Array, redWhiteData: Uint8Array): Uint8Array {
  const halfLength = blackWhiteData.length;
  const payloadData = new Uint8Array(halfLength * 4);
  let payloadIdx = 0;
  let black_data: number, color_data: number, data: number;
  for (let i = 0; i < halfLength; i++) {
    black_data = blackWhiteData[i];
    color_data = redWhiteData[i];
    for (let j = 0; j < 8; j++) {
      if ((color_data & 0x80) === 0x00) data = 0x04;  // red
      else if ((black_data & 0x80) === 0x00) data = 0x00;  // black
      else data = 0x03;  // white
      data = (data << 4) & 0xFF;
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      j++;
      if ((color_data & 0x80) === 0x00) data |= 0x04;  // red
      else if ((black_data & 0x80) === 0x00) data |= 0x00;  // black
      else data |= 0x03;  // white
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      payloadData[payloadIdx++] = data;
    }
  }
  return payloadData;
}

/**
 * 发送图片
 */
export async function sendimg(canvas: HTMLCanvasElement, canvasState: any): Promise<boolean> {
  // 检查设备连接状态
  if (!gattServer || !gattServer.connected || !epdCharacteristic) {
    addLog("发送图片失败：设备未连接");
    // 重置进度
    if (progressCallback) {
      progressCallback(0);
    }
    return false;
  }
  
  // 重置进度
  if (progressCallback) {
    progressCallback(0);
  }
  
  const ditherMode = canvasState.colorPalette;
  const canvasSize = `${canvas.width}_${canvas.height}`;

  // 模拟参考代码中的驱动选择
  const epdDriverSelect = document.getElementById('epddriver') as HTMLSelectElement;
  if (epdDriverSelect) {
    const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
    
    // 检查画布尺寸和驱动是否匹配（如果有数据的话）
    const driverCanvasSize = selectedOption.getAttribute('data-size');
    const driverColorMode = selectedOption.getAttribute('data-color');
    
    if (driverCanvasSize && driverCanvasSize !== canvasSize) {
      // 这里我们不弹出确认框，只记录日志
      addLog("警告：画布尺寸和驱动可能不匹配");
    }
    if (driverColorMode && driverColorMode !== ditherMode) {
      addLog("警告：颜色模式和驱动可能不匹配");
    }
  }

  startTime = new Date().getTime();
  setStatus(`开始发送，颜色模式: ${ditherMode}`);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    addLog("无法获取画布上下文");
    return false;
  }

  try {
    addLog(`开始发送图片，颜色模式: ${ditherMode}`);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // @ts-ignore - 暂时忽略类型错误
    const processedData = processImageData(imageData, ditherMode);

    updateButtonStatus(true);

    if (!(await write(EpdCmd.INIT))) {
      throw new Error("发送初始化命令失败");
    }

    if (ditherMode === 'fourColor') {
      addLog("使用四色模式发送图片");
      await writeImage(processedData, 'color');
    } else if (ditherMode === 'threeColor') {
      addLog("使用三色模式发送图片");
      const halfLength = Math.floor(processedData.length / 2);
      const blackWhiteData = processedData.slice(0, halfLength);
      const redWhiteData = processedData.slice(halfLength);
      
      // 参考代码中的UC8159转换支持
      if (epdDriverSelect && (epdDriverSelect.value === '08' || epdDriverSelect.value === '09')) {
        addLog("使用UC8159格式发送图片");
        await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
      } else {
        await writeImage(blackWhiteData, 'bw');
        await writeImage(redWhiteData, 'red');
      }
    } else if (ditherMode === 'blackWhiteColor') {
      addLog("使用双色模式发送图片");
      
      // 参考代码中的UC8159转换支持
      if (epdDriverSelect && (epdDriverSelect.value === '08' || epdDriverSelect.value === '09')) {
        addLog("使用UC8159格式发送图片");
        const emptyData = new Uint8Array(processedData.length).fill(0xFF);
        await writeImage(convertUC8159(processedData, emptyData), 'bw');
      } else {
        await writeImage(processedData, 'bw');
      }
    } else {
      addLog("当前固件不支持此颜色模式。");
      updateButtonStatus();
      return false;
    }

    if (!(await write(EpdCmd.REFRESH))) {
      throw new Error("发送刷新命令失败");
    }
    
    updateButtonStatus();

    // 设置进度为100%
    if (progressCallback) {
      progressCallback(100);
    }

    const sendTime = (new Date().getTime() - startTime) / 1000.0;
    addLog(`发送完成！耗时: ${sendTime}s`);
    setStatus(`发送完成！耗时: ${sendTime}s`);
    addLog("屏幕刷新完成前请不要操作。");
    return true;
  } catch (error) {
    console.error('发送图片失败:', error);
    addLog(`发送图片失败: ${error instanceof Error ? error.message : '未知错误'}`);
    updateButtonStatus();
    // 重置进度为0%
    if (progressCallback) {
      progressCallback(0);
    }
    return false;
  }
}

/**
 * 设置状态信息
 */
function setStatus(statusText: string): void {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = statusText;
  }
}

/**
 * 更新按钮状态
 */
export function updateButtonStatus(forceDisabled: boolean = false): void {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  
  const reconnectButton = document.getElementById("reconnectbutton");
  const sendcmdButton = document.getElementById("sendcmdbutton");
  const calendarModeButton = document.getElementById("calendarmodebutton");
  const clockModeButton = document.getElementById("clockmodebutton");
  const clearScreenButton = document.getElementById("clearscreenbutton");
  const sendImgButton = document.getElementById("sendimgbutton");
  const setDriverButton = document.getElementById("setDriverbutton");

  if (reconnectButton) {
    reconnectButton.disabled = (gattServer == null || gattServer.connected) ? true : false;
  }
  
  [sendcmdButton, calendarModeButton, clockModeButton, clearScreenButton, sendImgButton, setDriverButton].forEach(button => {
    if (button) {
      button.disabled = status === 'disabled';
    }
  });
}

/**
 * 断开连接
 */
export function disconnect(): void {
  updateButtonStatus();
  resetVariables();
  addLog('已断开连接.');
  const connectButton = document.getElementById("connectbutton");
  if (connectButton) {
    connectButton.innerHTML = '连接';
  }
}

/**
 * 预连接处理
 */
export async function preConnect(): Promise<void> {
  addLog("preConnect 函数被调用");
  addLog(`当前 gattServer 状态: ${gattServer ? (gattServer.connected ? '已连接' : '未连接') : 'null'}`);
  addLog(`当前 bleDevice 状态: ${bleDevice ? '已存在' : 'null'}`);
  
  if (gattServer != null && gattServer.connected) {
    addLog("设备已连接，开始断开连接");
    if (bleDevice != null && bleDevice.gatt?.connected) {
      bleDevice.gatt.disconnect();
      addLog("设备已断开连接");
    }
  }
  else {
    addLog("开始连接设备...");
    addLog("检查 navigator.bluetooth 是否可用: " + (navigator.bluetooth ? "是" : "否"));
    
    if (!navigator.bluetooth) {
      addLog("错误: 浏览器不支持蓝牙");
      return;
    }
    
    resetVariables();
    try {
      addLog("准备调用 navigator.bluetooth.requestDevice()");
      bleDevice = await navigator.bluetooth.requestDevice({
        optionalServices: ['62750001-d828-918d-fb46-b6c11c675aec'],
        acceptAllDevices: true
      });
      addLog(`已选择设备: ${bleDevice.name || '未知设备'}`);
    } catch (e) {
      console.error("requestDevice 异常:", e);
      if (e instanceof Error) {
        addLog(`requestDevice 失败: ${e.name}: ${e.message}`);
        addLog(`错误堆栈: ${e.stack}`);
      } else {
        addLog(`requestDevice 失败: 未知错误类型: ${JSON.stringify(e)}`);
      }
      addLog("请检查蓝牙是否已开启，且使用的浏览器支持蓝牙！建议使用以下浏览器：");
      addLog("• 电脑: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: Bluefy 浏览器");
      return;
    }

    bleDevice.addEventListener('gattserverdisconnected', disconnect);
    setTimeout(async function () { await connect(); }, 300);
  }
}

/**
 * 重连
 */
export async function reConnect(): Promise<void> {
  if (bleDevice != null && bleDevice.gatt?.connected) {
    bleDevice.gatt.disconnect();
  }
  resetVariables();
  addLog("正在重连");
  setTimeout(async function () { await connect(); }, 300);
}

/**
 * 处理通知
 */
function handleNotify(value: DataView, idx: number): void {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins") as HTMLInputElement;
    const epddriver = document.getElementById("epddriver") as HTMLSelectElement;
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    epddriver.value = bytes2hex(data.slice(7, 8));
    updateDitcherOptions();
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    addLog(msg, '⇓');
    if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      const mtuElement = document.getElementById('mtusize') as HTMLInputElement;
      if (mtuElement) {
        mtuElement.value = mtuSize.toString();
      }
      addLog(`MTU 已更新为: ${mtuSize}`);
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const t = parseInt(msg.substring(2)) + new Date().getTimezoneOffset() * 60;
      addLog(`远端时间: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
    }
  }
}

/**
 * 连接到蓝牙设备
 */
export async function connect(): Promise<void> {
  if (bleDevice == null) {
    addLog("未选择设备，连接失败");
    return;
  }
  if (epdCharacteristic != null) {
    addLog("设备已连接，无需重复连接");
    return;
  }

  try {
    addLog("正在连接 GATT 服务器: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('✓ 已连接到 GATT 服务器');
    
    epdService = await gattServer.getPrimaryService('62750001-d828-918d-fb46-b6c11c675aec');
    addLog('✓ 已找到 EPD Service');
    
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('✓ 已找到 Characteristic');
    
    addLog("设备连接成功！");
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message) {
      addLog(`连接失败: ${e.message}`);
    } else {
      addLog("连接失败: 未知错误");
    }
    disconnect();
    return;
  }

  try {
    const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
    const versionData = await versionCharacteristic.readValue();
    appVersion = versionData.getUint8(0);
    addLog(`固件版本: 0x${appVersion.toString(16)}`);
  } catch (e) {
    console.error(e);
    appVersion = 0x15;
    addLog("获取固件版本失败，使用默认版本 0x15");
  }

  if (appVersion < 0x16) {
    const oldURL = "https://tsl0922.github.io/EPD-nRF5/v1.5";
    alert("!!!注意!!!\n当前固件版本过低，可能无法正常使用部分功能，建议升级到最新版本。");
    if (confirm('是否访问旧版本上位机？')) {
      location.href = oldURL;
    }
    setTimeout(() => {
      addLog(`如遇到问题，可访问旧版本上位机: ${oldURL}`);
    }, 500);
  }

  try {
    await epdCharacteristic.startNotifications();
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
    addLog("已开启通知监听");
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message) addLog(`开启通知监听失败: ${e.message}`);
  }

  try {
    await write(EpdCmd.INIT);
    addLog("已发送初始化命令");
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message) addLog(`发送初始化命令失败: ${e.message}`);
  }

  const connectButton = document.getElementById("connectbutton");
  if (connectButton) {
    connectButton.innerHTML = '断开';
  }
}

/**
 * 更新抖动选项
 */
export function updateDitcherOptions(): void {
  const epdDriverSelect = document.getElementById('epddriver') as HTMLSelectElement;
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  const ditherModeSelect = document.getElementById('ditherMode') as HTMLSelectElement;
  const canvasSizeSelect = document.getElementById('canvasSize') as HTMLSelectElement;

  if (colorMode && ditherModeSelect) {
    ditherModeSelect.value = colorMode;
  }
  if (canvasSize && canvasSizeSelect) {
    canvasSizeSelect.value = canvasSize;
  }

  // @ts-ignore - 暂时忽略类型错误，后续会实现updateCanvasSize函数
  updateCanvasSize(); // always update image
}
