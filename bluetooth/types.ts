/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bluetooth相关常量
export const EpdCmd = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  SEND_CMD: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  SLEEP: 0x06,
  SET_TIME: 0x20,
  WRITE_IMG: 0x30,
  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
} as const;

// 画布尺寸定义
export interface CanvasSize {
  name: string;
  width: number;
  height: number;
}

// 颜色模式
export type DitherMode = 'blackWhiteColor' | 'threeColor' | 'fourColor' | 'sixColor';

// 抖动算法
export type DitherAlgorithm = 'floydSteinberg' | 'atkinson' | 'bayer' | 'stucki' | 'jarvis' | 'none';

// 颜色调色板项
export interface ColorPaletteItem {
  name: string;
  r: number;
  g: number;
  b: number;
  value: number;
}

// 画笔工具类型
export type ToolType = 'brush' | 'eraser' | 'text' | null;

// 蓝牙设备连接状态
export type BluetoothStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// 图像数据处理结果
export interface ProcessedImageData {
  data: Uint8Array;
  mode: DitherMode;
}

// 画布状态
export interface CanvasState {
  imageData: ImageData;
  textElements: TextElement[];
  lineSegments: LineSegment[];
  drawProgress?: number;
}

// 文本元素
export interface TextElement {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
}

// 线条段
export type LineSegment = DotSegment | LineSegment;

// 点段
export interface DotSegment {
  type: 'dot';
  x: number;
  y: number;
  color: string;
  size: number;
}

// 线段
export interface LineSegment {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
}
