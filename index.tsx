/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import SideDrawer from './components/SideDrawer';
import { PaintManager, CropManager } from './bluetooth/canvas';
import { preConnect, connect, write, sendimg, syncTime, clearScreen, setDriver } from './bluetooth/bluetooth';
import { updateCanvasSize, updateImage, applyDither, convertDithering, rotateCanvas, clearCanvas } from './bluetooth/canvas';
import { BluetoothStatus, CanvasState, ColorPalette } from './bluetooth/types';

// Types
type Color = '#FF0000' | '#000000' | '#FFFFFF';

interface Shape {
    id: string;
    type: 'rect';
    x: number;
    y: number;
    w: number;
    h: number;
    color: Color;
}

interface SentText {
    id: string;
    text: string;
    x: number;
    y: number;
    color: Color;
    fontSize: number;
}

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const SQUARE_SIZE = 50;
const MIN_SIZE = 20;
const HANDLE_SIZE = 15; // Size of the resize handle area
const ROW_COUNT = 6;
const ROW_HEIGHT = CANVAS_HEIGHT / ROW_COUNT;

function App() {
    // State
    const [color, setColor] = useState<Color>('#FF0000');
    const [text, setText] = useState<string>('');
    const [textPos, setTextPos] = useState<{x: number, y: number}>({ x: CANVAS_WIDTH / 2, y: ROW_HEIGHT / 2 + ROW_HEIGHT * 2 }); // Start at line 3
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sentTexts, setSentTexts] = useState<SentText[]>([]); // 存储已发送的文字
    const [fontSize, setFontSize] = useState<number>(24); // 字体大小，默认24px

    // Refs
    const inputRef = useRef<HTMLInputElement>(null);

    // Bluetooth State
    const [bluetoothStatus, setBluetoothStatus] = useState<BluetoothStatus>({
        connected: false,
        deviceName: '',
        log: [],
        debug: false
    });

    // Canvas State for Bluetooth
    const [canvasState, setCanvasState] = useState<CanvasState>({
        width: 400,
        height: 300,
        dithering: 'floydSteinberg',
        contrast: 1.2,
        strength: 1.0,
        colorPalette: 'blackWhiteColor'
    });

    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bluetoothCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const paintManagerRef = useRef<PaintManager | null>(null);
    const cropManagerRef = useRef<CropManager | null>(null);
    // 保存原始图像数据，用于抖动处理
    const originalImageRef = useRef<ImageData | null>(null);
    
    // Interaction state ref
    const dragInfoRef = useRef<{ 
        mode: 'dragging' | 'resizing' | 'draggingText';
        id?: string; 
        startX: number; 
        startY: number;
        originalX: number;
        originalY: number;
        originalW?: number;
        originalH?: number;
    } | null>(null);
    
    const rafRef = useRef<number>(0);

    // Initialize canvas size and PaintManager when component mounts
    useEffect(() => {
        if (canvasRef.current) {
            const canvas = canvasRef.current;
            const wrapper = canvas.parentElement;
            if (wrapper) {
                // 获取canvas-wrapper的实际显示尺寸
                const rect = wrapper.getBoundingClientRect();
                // 设置canvas的实际像素尺寸与显示尺寸匹配
                canvas.width = Math.floor(rect.width);
                canvas.height = Math.floor(rect.height);
            }
            
            const ctx = canvas.getContext('2d');
            if (ctx) {
                paintManagerRef.current = new PaintManager(canvas, ctx);
                cropManagerRef.current = new CropManager(canvas, ctx);
                // Initialize paint tools
                paintManagerRef.current.initPaintTools();
            }
        }
    }, []);

    // Update log when bluetooth status changes
    const updateLog = useCallback((message: string) => {
        setBluetoothStatus(prev => ({
            ...prev,
            log: [...prev.log, { timestamp: new Date().toISOString(), message }]
        }));
    }, []);

    // Set log callback for bluetooth module
    useEffect(() => {
        // Import setLogCallback dynamically to avoid circular dependencies
        import('./bluetooth/bluetooth').then(({ setLogCallback }) => {
            setLogCallback(updateLog);
        });
    }, [updateLog]);

    // Bluetooth control handlers
    const handlePreConnect = useCallback(async () => {
        try {
            await preConnect();
            // 连接成功后更新状态
            setBluetoothStatus(prev => ({
                ...prev,
                connected: true
            }));
        } catch (error) {
            updateLog(`连接失败: ${error instanceof Error ? error.message : '未知错误'}`);
            // 连接失败后更新状态
            setBluetoothStatus(prev => ({
                ...prev,
                connected: false
            }));
        }
    }, [updateLog]);

    const handleSyncTime = useCallback((mode: number) => {
        syncTime(mode).then(() => {
            updateLog('时间同步成功');
        }).catch(error => {
            updateLog(`时间同步失败: ${error.message}`);
        });
    }, [updateLog]);

    const handleClearScreen = useCallback(() => {
        clearScreen().then(() => {
            updateLog('屏幕清除成功');
        }).catch(error => {
            updateLog(`屏幕清除失败: ${error.message}`);
        });
    }, [updateLog]);

    const handleSendImage = useCallback(() => {
        if (bluetoothCanvasRef.current) {
            sendimg(bluetoothCanvasRef.current, canvasState).then(() => {
                updateLog('图片发送成功');
            }).catch(error => {
                updateLog(`图片发送失败: ${error.message}`);
            });
        }
    }, [canvasState, updateLog]);

    const handleApplyDither = useCallback(() => {
        if (bluetoothCanvasRef.current) {
            applyDither(bluetoothCanvasRef.current, canvasState);
            updateLog('抖动算法应用成功');
        }
    }, [canvasState, updateLog]);

    const handleUpdateCanvasSize = useCallback(() => {
        if (bluetoothCanvasRef.current) {
            updateCanvasSize(bluetoothCanvasRef.current, canvasState.width, canvasState.height);
        }
    }, [canvasState.width, canvasState.height]);

    const handleClearCanvas = useCallback(() => {
        if (bluetoothCanvasRef.current) {
            clearCanvas(bluetoothCanvasRef.current);
        }
    }, []);

    const handleRotateCanvas = useCallback(() => {
        if (bluetoothCanvasRef.current) {
            rotateCanvas(bluetoothCanvasRef.current);
        }
    }, []);

    const handleUpdateImage = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (bluetoothCanvasRef.current && event.target.files && event.target.files[0]) {
            updateImage(bluetoothCanvasRef.current, event.target.files[0]).then(() => {
                updateLog('图片更新成功');
                // 保存原始图像数据，用于后续抖动处理
                const ctx = bluetoothCanvasRef.current.getContext('2d');
                if (ctx) {
                    originalImageRef.current = ctx.getImageData(0, 0, bluetoothCanvasRef.current.width, bluetoothCanvasRef.current.height);
                    // 图片加载完成后，立即应用当前的canvasState设置
                    applyDither(bluetoothCanvasRef.current, canvasState);
                }
            }).catch(error => {
                updateLog(`图片更新失败: ${error.message}`);
            });
        }
    }, [updateLog, canvasState]);

    // Update canvas state handlers
    const handleCanvasStateChange = useCallback((key: keyof CanvasState, value: any) => {
        setCanvasState(prev => ({ ...prev, [key]: value }));
    }, []);

    // Automatically apply dither when canvas state changes
    useEffect(() => {
        if (bluetoothCanvasRef.current && originalImageRef.current) {
            const ctx = bluetoothCanvasRef.current.getContext('2d');
            if (ctx) {
                // 先恢复原始图像
                ctx.putImageData(originalImageRef.current, 0, 0);
                // 然后应用抖动效果
                applyDither(bluetoothCanvasRef.current, canvasState);
            }
        }
    }, [canvasState]);

    // 当字体大小变化时，立即重新绘制画布
    useEffect(() => {
        // 直接调用draw函数，而不依赖requestAnimationFrame
        draw();
    }, [fontSize]);

    // 当选中元素变化时，更新字体大小和颜色控件的值
    useEffect(() => {
        if (selectedId) {
            // 检查是否选中了文字
            const selectedText = sentTexts.find(text => text.id === selectedId);
            if (selectedText) {
                // 如果选中了文字，将字体大小和颜色控件的值设置为该文字的属性
                setFontSize(selectedText.fontSize);
                setColor(selectedText.color);
                return;
            }
            
            // 检查是否选中了方块
            const selectedShape = shapes.find(shape => shape.id === selectedId);
            if (selectedShape) {
                // 如果选中了方块，将颜色控件的值设置为该方块的颜色
                setColor(selectedShape.color);
            }
        }
    }, [selectedId, sentTexts, shapes]);

    // Send text handler
    const handleSendText = useCallback(() => {
        if (text.trim()) {
            // Create a new sent text object
            const newSentText: SentText = {
                id: generateId(),
                text: text,
                x: textPos.x,
                y: textPos.y,
                color: color,
                fontSize: fontSize
            };
            
            // Add to sent texts array
            setSentTexts(prev => [...prev, newSentText]);
            
            // Clear input and reset position
            setText('');
            setTextPos({ 
                x: CANVAS_WIDTH / 2, 
                y: ROW_HEIGHT / 2 + ROW_HEIGHT * 2 
            });
            
            // Focus back on input
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }
    }, [text, textPos, color, fontSize]);

    // --- Service Worker Registration for PWA ---
    useEffect(() => {
        const registerSW = async () => {
            if ('serviceWorker' in navigator) {
                try {
                    // Register the standalone sw.js file
                    const registration = await navigator.serviceWorker.register('/sw.js');
                    console.log('SW Registered with scope:', registration.scope);
                } catch (e) {
                    console.error('SW Registration Failed:', e);
                }
            }
        };
        registerSW();
    }, []);

    // --- Helpers ---
    const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    const getCanvasPoint = (evt: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in evt ? evt.touches[0].clientX : (evt as React.MouseEvent).clientX;
        const clientY = 'touches' in evt ? evt.touches[0].clientY : (evt as React.MouseEvent).clientY;

        // 使用canvas的实际像素尺寸进行计算
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };
    
    // 文字自动换行函数
    const wrapText = useCallback((ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
        if (!text || text === '') return [''];
        
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = words[0];
        
        for (let i = 1; i < words.length; i++) {
            const testLine = currentLine + ' ' + words[i];
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            
            if (testWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = words[i];
            }
        }
        lines.push(currentLine);
        
        return lines;
    }, []);
    
    // 计算文字宽度的辅助函数
    const getTextWidth = useCallback((ctx: CanvasRenderingContext2D, text: string, fontSize: number): number => {
        ctx.font = `bold ${fontSize}px Nightgazer12, monospace`;
        return ctx.measureText(text).width;
    }, []);
    
    // 测量文字行高的辅助函数
    const getTextHeight = useCallback((fontSize: number): number => {
        return fontSize * 1.2; // 行高为字体大小的1.2倍
    }, []);

    // --- Core Logic ---

    // Drawing Loop
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        // 使用canvas实际尺寸
        const actualWidth = canvas.width;
        const actualHeight = canvas.height;
        const actualRowHeight = Math.floor(actualHeight / ROW_COUNT);

        // Clear
        ctx.fillStyle = '#ffffff'; // White paper background
        ctx.fillRect(0, 0, actualWidth, actualHeight);

        // Draw Row Lines (Notebook Style)
        ctx.beginPath();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        for (let i = 1; i < ROW_COUNT; i++) {
            const y = i * actualRowHeight;
            ctx.moveTo(0, y);
            ctx.lineTo(actualWidth, y);
        }
        ctx.stroke();

        // Draw Shapes
        shapes.forEach(shape => {
            ctx.fillStyle = shape.color;
            ctx.fillRect(shape.x, shape.y, shape.w, shape.h);

            // Selection Border
            if (shape.id === selectedId) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(shape.x - 2, shape.y - 2, shape.w + 4, shape.h + 4);
                
                // Draw Resize Handle (Bottom Right)
                ctx.setLineDash([]);
                ctx.fillStyle = '#000'; // Handle color
                ctx.fillRect(
                    shape.x + shape.w - 5, 
                    shape.y + shape.h - 5, 
                    10, 
                    10
                );
                
                // Reset styling
                ctx.setLineDash([]);
            } else {
                // Subtle border for visibility if white on white
                if (shape.color === '#FFFFFF') {
                    ctx.strokeStyle = '#ccc';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
                }
            }
        });

        // 优化像素字体渲染
        ctx.imageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.msImageSmoothingEnabled = false;
        
        const unsentFontSize = Math.round(fontSize);
        const unsentLineHeight = unsentFontSize * 1.2;
        
        // Draw Sent Texts (Locked, cannot be modified)
        sentTexts.forEach(sentText => {
            ctx.fillStyle = sentText.color;
            const sentFontSize = Math.round(sentText.fontSize);
            const sentLineHeight = sentFontSize * 1.2;
            ctx.font = `bold ${sentFontSize}px Nightgazer12, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // 计算最大宽度（画布宽度的80%，避免文字太靠近边缘）
            const maxWidth = actualWidth * 0.8;
            
            // 处理文字换行
            const words = sentText.text.split(' ');
            const lines: string[] = [];
            let currentLine = words[0] || '';
            
            for (let i = 1; i < words.length; i++) {
                const testLine = currentLine + ' ' + words[i];
                const testWidth = ctx.measureText(testLine).width;
                
                if (testWidth <= maxWidth) {
                    currentLine = testLine;
                } else {
                    lines.push(currentLine);
                    currentLine = words[i];
                }
            }
            lines.push(currentLine);
            
            // 绘制多行文字
            const totalHeight = lines.length * sentLineHeight;
            const startY = sentText.y - (totalHeight - sentLineHeight) / 2;
            
            lines.forEach((line, index) => {
                ctx.fillText(line, sentText.x, startY + index * sentLineHeight);
            });
            
            // 如果文字被选中，添加虚线边框
            if (sentText.id === selectedId) {
                const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(
                    sentText.x - textWidth / 2 - 4,
                    sentText.y - totalHeight / 2 - 4,
                    textWidth + 8,
                    totalHeight + 8
                );
                ctx.setLineDash([]);
            }
        });

        // Draw Current Text (Editable, not yet sent)
        if (text) {
            ctx.fillStyle = color;
            ctx.font = `bold ${unsentFontSize}px Nightgazer12, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // 计算最大宽度
            const maxWidth = actualWidth * 0.8;
            
            // 处理文字换行
            const words = text.split(' ');
            const lines: string[] = [];
            let currentLine = words[0] || '';
            
            for (let i = 1; i < words.length; i++) {
                const testLine = currentLine + ' ' + words[i];
                const testWidth = ctx.measureText(testLine).width;
                
                if (testWidth <= maxWidth) {
                    currentLine = testLine;
                } else {
                    lines.push(currentLine);
                    currentLine = words[i];
                }
            }
            lines.push(currentLine);
            
            // 绘制多行文字
            const totalHeight = lines.length * unsentLineHeight;
            const startY = textPos.y - (totalHeight - unsentLineHeight) / 2;
            
            lines.forEach((line, index) => {
                ctx.fillText(line, textPos.x, startY + index * unsentLineHeight);
            });
        }

    }, [shapes, selectedId, text, color, textPos, sentTexts, fontSize]);

    useEffect(() => {
        const loop = () => {
            draw();
            rafRef.current = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(rafRef.current!);
    }, [draw]);

    // --- Interaction Handlers ---

    const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
        // Prevent default only if inside canvas to avoid scrolling on touch
        if (e.type === 'touchstart') {
            // e.preventDefault() is handled in passive listener usually, 
            // but react synthetic events are different. 
            // We'll rely on css touch-action: none.
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const pos = getCanvasPoint(e);
        
        // 0. Check if clicking on unsent text (Text is drawn on top)
        if (text) {
            const unsentFontSize = Math.round(fontSize);
            ctx.font = `bold ${unsentFontSize}px Nightgazer12, monospace`;
            const metrics = ctx.measureText(text);
            const textW = metrics.width;
            const textH = unsentFontSize;
            
            // Simple bounding box for text center
            if (
                pos.x >= textPos.x - textW / 2 && 
                pos.x <= textPos.x + textW / 2 &&
                pos.y >= textPos.y - textH / 2 && 
                pos.y <= textPos.y + textH / 2
            ) {
                // Select text for dragging
                dragInfoRef.current = {
                    mode: 'draggingText',
                    startX: pos.x,
                    startY: pos.y,
                    originalX: textPos.x,
                    originalY: textPos.y
                };
                setSelectedId(null); // Deselect shapes
                return;
            }
        }
        
        // 1. Check if clicking on sent text
        for (let i = sentTexts.length - 1; i >= 0; i--) {
            const sentText = sentTexts[i];
            const sentFontSize = Math.round(sentText.fontSize);
            const sentLineHeight = sentFontSize * 1.2;
            ctx.font = `bold ${sentFontSize}px Nightgazer12, monospace`;
            ctx.textAlign = 'center';
            
            // Calculate text bounding box
            const maxWidth = canvas.width * 0.8;
            const words = sentText.text.split(' ');
            const lines: string[] = [];
            let currentLine = words[0] || '';
            
            for (let j = 1; j < words.length; j++) {
                const testLine = currentLine + ' ' + words[j];
                const testWidth = ctx.measureText(testLine).width;
                if (testWidth <= maxWidth) {
                    currentLine = testLine;
                } else {
                    lines.push(currentLine);
                    currentLine = words[j];
                }
            }
            lines.push(currentLine);
            
            const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
            const textHeight = lines.length * sentLineHeight;
            
            // Check if click is within text bounding box
            if (
                pos.x >= sentText.x - textWidth / 2 - 10 && 
                pos.x <= sentText.x + textWidth / 2 + 10 &&
                pos.y >= sentText.y - textHeight / 2 - 10 && 
                pos.y <= sentText.y + textHeight / 2 + 10
            ) {
                // Select sent text
                setSelectedId(sentText.id);
                dragInfoRef.current = {
                    mode: 'draggingText',
                    id: sentText.id,
                    startX: pos.x,
                    startY: pos.y,
                    originalX: sentText.x,
                    originalY: sentText.y
                };
                return;
            }
        }

        // 1. Check if clicking the Resize Handle of the currently selected shape
        if (selectedId) {
            const selectedShape = shapes.find(s => s.id === selectedId);
            if (selectedShape) {
                const handleX = selectedShape.x + selectedShape.w;
                const handleY = selectedShape.y + selectedShape.h;
                // Check distance to bottom-right corner
                if (
                    pos.x >= handleX - HANDLE_SIZE && 
                    pos.x <= handleX + HANDLE_SIZE &&
                    pos.y >= handleY - HANDLE_SIZE &&
                    pos.y <= handleY + HANDLE_SIZE
                ) {
                    dragInfoRef.current = {
                        mode: 'resizing',
                        id: selectedId,
                        startX: pos.x,
                        startY: pos.y,
                        originalX: selectedShape.x,
                        originalY: selectedShape.y,
                        originalW: selectedShape.w,
                        originalH: selectedShape.h,
                    };
                    return; // Stop here, we are resizing
                }
            }
        }

        // 2. Find clicked shape (iterate backwards for z-index)
        let hitShape = null;
        for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            if (pos.x >= s.x && pos.x <= s.x + s.w && pos.y >= s.y && pos.y <= s.y + s.h) {
                hitShape = s;
                break;
            }
        }

        if (hitShape) {
            setSelectedId(hitShape.id);
            // Move to front (end of array)
            setShapes(prev => {
                const others = prev.filter(s => s.id !== hitShape!.id);
                return [...others, hitShape!];
            });
            
            dragInfoRef.current = {
                mode: 'dragging',
                id: hitShape.id,
                startX: pos.x,
                startY: pos.y,
                originalX: hitShape.x,
                originalY: hitShape.y,
                originalW: hitShape.w,
                originalH: hitShape.h
            };
        } else {
            setSelectedId(null);
            dragInfoRef.current = null;
        }
    };

    const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!dragInfoRef.current) return;

        const pos = getCanvasPoint(e);
        const { mode, id, startX, startY, originalX, originalY, originalW, originalH } = dragInfoRef.current;

        if (mode === 'draggingText') {
            const dx = pos.x - startX;
            const dy = pos.y - startY;
            
            // Free movement X and Y for sent text, constrained for unsent text
            if (id) {
                // Dragging sent text
                setSentTexts(prev => prev.map(sentText => {
                    if (sentText.id === id) {
                        return {
                            ...sentText,
                            x: originalX + dx,
                            y: originalY + dy
                        };
                    }
                    return sentText;
                }));
            } else {
                // Dragging unsent text
                let newX = originalX + dx;
                
                // Constrained movement Y (Snap to rows)
                // Calculate which row we are closest to
                // Mouse Y relative to drag start
                const currentMouseY = pos.y;
                // 使用canvas的实际高度进行计算
                const canvas = canvasRef.current;
                if (canvas) {
                    // Clamp to canvas area
                    const clampedY = Math.max(0, Math.min(canvas.height, currentMouseY));
                    
                    // Calculate actual row height based on canvas height
                    const actualRowHeight = canvas.height / ROW_COUNT;
                    // Find row index (0 to 5)
                    const rowIndex = Math.floor(clampedY / actualRowHeight);
                    // Center of that row
                    const snappedY = (rowIndex * actualRowHeight) + (actualRowHeight / 2);

                    setTextPos({ x: newX, y: snappedY });
                }
            }
            return;
        }

        if (id) {
            // Check if dragging a shape or sent text
            const isText = sentTexts.some(sentText => sentText.id === id);
            
            if (isText) {
                // Dragging sent text
                if (mode === 'dragging') {
                    const dx = pos.x - startX;
                    const dy = pos.y - startY;
                    setSentTexts(prev => prev.map(sentText => {
                        if (sentText.id === id) {
                            return {
                                ...sentText,
                                x: originalX + dx,
                                y: originalY + dy
                            };
                        }
                        return sentText;
                    }));
                }
            } else {
                // Dragging shape
                setShapes(prev => prev.map(s => {
                    if (s.id !== id) return s;

                    if (mode === 'dragging') {
                        const dx = pos.x - startX;
                        const dy = pos.y - startY;
                        return {
                            ...s,
                            x: originalX + dx,
                            y: originalY + dy
                        };
                    } else if (mode === 'resizing') {
                        const dx = pos.x - startX;
                        const dy = pos.y - startY;
                        return {
                            ...s,
                            w: Math.max(MIN_SIZE, (originalW || 0) + dx),
                            h: Math.max(MIN_SIZE, (originalH || 0) + dy)
                        };
                    }
                    return s;
                }));
            }
        }
    };

    const handlePointerUp = () => {
        dragInfoRef.current = null;
    };

    const handleAddSquare = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const newShape: Shape = {
            id: generateId(),
            type: 'rect',
            x: canvas.width / 2 - SQUARE_SIZE / 2,
            y: canvas.height / 2 - SQUARE_SIZE / 2,
            w: SQUARE_SIZE,
            h: SQUARE_SIZE,
            color: color
        };
        setShapes(prev => [...prev, newShape]);
        setSelectedId(newShape.id);
    };

    const handleDelete = () => {
        if (selectedId) {
            // Check if deleting a shape or sent text
            const isText = sentTexts.some(sentText => sentText.id === selectedId);
            
            if (isText) {
                // Delete sent text
                setSentTexts(prev => prev.filter(sentText => sentText.id !== selectedId));
            } else {
                // Delete shape
                setShapes(prev => prev.filter(s => s.id !== selectedId));
            }
            setSelectedId(null);
        }
    };

    const handleClear = () => {
        setShapes([]);
        setText('');
        setSelectedId(null);
    };

    const handleExport = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'neon-note.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const pos = getCanvasPoint(e);
        
        // Find hit shape
        for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            if (pos.x >= s.x && pos.x <= s.x + s.w && pos.y >= s.y && pos.y <= s.y + s.h) {
                // Cycle Color
                const colors: Color[] = ['#FF0000', '#000000', '#FFFFFF'];
                const currentIndex = colors.indexOf(s.color);
                const nextColor = colors[(currentIndex + 1) % colors.length];
                
                setShapes(prev => prev.map(shape => 
                    shape.id === s.id ? { ...shape, color: nextColor } : shape
                ));
                return; // Only affect top shape
            }
        }
    };

    // Keyboard support
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedId && document.activeElement?.tagName !== 'INPUT') {
                    handleDelete();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId]);

    return (
                <div className="app-container" ref={containerRef}>
                    <header className="header">
                        <h1 className="title flicker-text" style={{ fontSize: 'calc(var(--title-font-size) + 3px)' }}>Ink-notes</h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button 
                                onClick={() => setIsDrawerOpen(true)} 
                                className="bluetooth-toggle-btn"
                            >
                                蓝牙控制面板
                            </button>
                        </div>
                    </header>

                    <div className="canvas-wrapper">
                        <canvas
                            ref={canvasRef}
                            width={CANVAS_WIDTH}
                            height={CANVAS_HEIGHT}
                            onMouseDown={handlePointerDown}
                            onMouseMove={handlePointerMove}
                            onMouseUp={handlePointerUp}
                            onMouseLeave={handlePointerUp}
                            onTouchStart={handlePointerDown}
                            onTouchMove={handlePointerMove}
                            onTouchEnd={handlePointerUp}
                            onContextMenu={handleContextMenu}
                        />
                    </div>

                    <div className="controls-area">
                        {/* 颜色选择和字体大小设置放在同一行 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            {/* 左边：三个颜色选择 */}
                            <div className="color-selector">
                                {(['#FF0000', '#000000', '#FFFFFF'] as Color[]).map(c => (
                                    <div
                                        key={c}
                                        className={`color-btn ${c === '#FF0000' ? 'btn-red' : c === '#000000' ? 'btn-black' : 'btn-white'} ${color === c ? 'selected' : ''}`}
                                        onClick={() => {
                                            if (selectedId) {
                                                // 检查是否选中了文字
                                                const isText = sentTexts.some(sentText => sentText.id === selectedId);
                                                if (isText) {
                                                    // 修改选中文字的颜色
                                                    setSentTexts(prev => prev.map(sentText => {
                                                        if (sentText.id === selectedId) {
                                                            return { ...sentText, color: c };
                                                        }
                                                        return sentText;
                                                    }));
                                                } else {
                                                    // 修改选中方块的颜色
                                                    setShapes(prev => prev.map(shape => {
                                                        if (shape.id === selectedId) {
                                                            return { ...shape, color: c };
                                                        }
                                                        return shape;
                                                    }));
                                                }
                                            } else {
                                                // 没有选中元素，修改全局颜色
                                                setColor(c);
                                            }
                                        }}
                                        title={c === '#FF0000' ? '红色' : c === '#000000' ? '黑色' : '白色'}
                                    />
                                ))}
                            </div>
                            
                            {/* 右边：字体大小设置 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0px' }}>
                                <label htmlFor="font-size" style={{ whiteSpace: 'nowrap', marginRight: '8px' }}>字体大小:</label>
                                <button
                                    onClick={() => {
                                        if (selectedId) {
                                            // 如果有选中的文字，只调整选中文字的字体大小
                                            const isText = sentTexts.some(sentText => sentText.id === selectedId);
                                            if (isText) {
                                                setSentTexts(prev => prev.map(sentText => {
                                                    if (sentText.id === selectedId) {
                                                        return { ...sentText, fontSize: Math.max(8, sentText.fontSize - 2) };
                                                    }
                                                    return sentText;
                                                }));
                                                return;
                                            }
                                        }
                                        // 否则调整全局字体大小
                                        setFontSize(prev => Math.max(8, prev - 2));
                                    }}
                                    style={{ 
                                        padding: '4px 8px', 
                                        border: '1px solid #ff003c', 
                                        borderRadius: '4px 0 0 4px', 
                                        backgroundColor: 'black', 
                                        color: '#ff003c',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px'
                                    }}
                                    title="减小字体"
                                >
                                    -
                                </button>
                                <input
                                    type="number"
                                    id="font-size"
                                    min="8"
                                    max="72"
                                    value={fontSize}
                                    onChange={(e) => {
                                        const newSize = parseInt(e.target.value) || 24;
                                        if (selectedId) {
                                            // 如果有选中的文字，只调整选中文字的字体大小
                                            const isText = sentTexts.some(sentText => sentText.id === selectedId);
                                            if (isText) {
                                                setSentTexts(prev => prev.map(sentText => {
                                                    if (sentText.id === selectedId) {
                                                        return { ...sentText, fontSize: newSize };
                                                    }
                                                    return sentText;
                                                }));
                                                return;
                                            }
                                        }
                                        // 否则调整全局字体大小
                                        setFontSize(newSize);
                                    }}
                                    style={{ 
                                        width: '60px', 
                                        padding: '4px', 
                                        textAlign: 'center',
                                        border: '1px solid #ff003c',
                                        borderLeft: 'none',
                                        borderRight: 'none',
                                        backgroundColor: 'black',
                                        color: 'white',
                                        fontWeight: 'bold',
                                        appearance: 'textfield', // 隐藏默认的数字输入框增减按钮
                                        fontFamily: 'inherit'
                                    }}
                                    onWheel={(e) => e.preventDefault()} // 阻止滚轮改变数值
                                />
                                <button
                                    onClick={() => {
                                        if (selectedId) {
                                            // 如果有选中的文字，只调整选中文字的字体大小
                                            const isText = sentTexts.some(sentText => sentText.id === selectedId);
                                            if (isText) {
                                                setSentTexts(prev => prev.map(sentText => {
                                                    if (sentText.id === selectedId) {
                                                        return { ...sentText, fontSize: Math.min(72, sentText.fontSize + 2) };
                                                    }
                                                    return sentText;
                                                }));
                                                return;
                                            }
                                        }
                                        // 否则调整全局字体大小
                                        setFontSize(prev => Math.min(72, prev + 2));
                                    }}
                                    style={{ 
                                        padding: '4px 8px', 
                                        border: '1px solid #ff003c', 
                                        borderRadius: '0 4px 4px 0', 
                                        backgroundColor: 'black', 
                                        color: '#ff003c',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px'
                                    }}
                                    title="增大字体"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                <div className="input-group" style={{ display: 'flex', gap: '8px' }}>
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="输入文字..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                                handleSendText();
                            }
                        }}
                    />
                    <button
                        onClick={handleSendText}
                        className="primary"
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        发送
                    </button>
                </div>

                <div className="button-grid">
                    <button onClick={handleAddSquare}>+ 添加方块</button>
                    <button onClick={handleDelete} disabled={!selectedId} className={selectedId ? 'danger' : ''}>删除选中</button>
                    <button onClick={handleClear}>清空画布</button>
                </div>
                
                <button style={{width: '100%', marginTop: '8px'}} onClick={handleExport}>
                    导出图片 (.PNG)
                </button>

                <div className="instructions">
                    @2026 笑匠制作
                </div>
            </div>

            {/* Bluetooth Control Panel Side Drawer */}
            <SideDrawer 
                isOpen={isDrawerOpen} 
                onClose={() => setIsDrawerOpen(false)} 
                title="蓝牙控制面板"
            >
                <div className="bluetooth-panel">
                    {/* Bluetooth Connection */}
                    <fieldset>
                        <legend>蓝牙连接</legend>
                        <div className="flex-container">
                            <div className="flex-group">
                                <button 
                                    type="button" 
                                    className="primary" 
                                    onClick={handlePreConnect}
                                >
                                    连接
                                </button>
                                <button 
                                    type="button" 
                                    className="secondary" 
                                    onClick={() => {
                                        updateLog('重连功能开发中');
                                    }}
                                >
                                    重连
                                </button>
                                <button 
                                    type="button" 
                                    className="secondary" 
                                    onClick={() => {
                                        setBluetoothStatus(prev => ({ ...prev, log: [] }));
                                    }}
                                >
                                    清空日志
                                </button>
                            </div>
                            {bluetoothStatus.debug && (
                                <>
                                    <div className="flex-group right debug">
                                        <label htmlFor="epddriver">驱动</label>
                                        <select id="epddriver">
                                            <option value="01" data-color="blackWhiteColor" data-size="4.2_400_300">4.2寸 (黑白, UC8176)</option>
                                            <option value="03" data-color="threeColor" data-size="4.2_400_300">4.2寸 (三色, UC8176)</option>
                                            <option value="04" data-color="blackWhiteColor" data-size="4.2_400_300">4.2寸 (黑白, SSD1619)</option>
                                            <option value="02" data-color="threeColor" data-size="4.2_400_300">4.2寸 (三色, SSD1619)</option>
                                            <option value="05" data-color="fourColor" data-size="4.2_400_300">4.2寸 (四色, JD79668)</option>
                                        </select>
                                    </div>
                                    <div className="flex-group debug">
                                        <label htmlFor="epdpins">引脚</label>
                                        <input id="epdpins" type="text" value="" />
                                        <button 
                                            id="setDriverbutton" 
                                            type="button" 
                                            className="primary" 
                                            onClick={() => {
                                                setDriver().then(() => {
                                                    updateLog('驱动设置成功');
                                                }).catch(error => {
                                                    updateLog(`驱动设置失败: ${error.message}`);
                                                });
                                            }}
                                        >
                                            确定
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="log-container" id="log">
                            {bluetoothStatus.log.map((entry, index) => (
                                <div key={index} className="log-entry">
                                    [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
                                </div>
                            ))}
                        </div>
                    </fieldset>

                    {/* Device Control */}
                    <fieldset>
                        <legend>设备控制</legend>
                        <div className="flex-container">
                            <div className="flex-group">
                                <button 
                                    type="button" 
                                    className="primary" 
                                    onClick={() => handleSyncTime(1)}
                                >
                                    日历模式
                                </button>
                                <button 
                                    type="button" 
                                    className="primary" 
                                    onClick={() => handleSyncTime(2)}
                                >
                                    时钟模式
                                </button>
                                <button 
                                    type="button" 
                                    className="secondary" 
                                    onClick={handleClearScreen}
                                >
                                    清除屏幕
                                </button>
                            </div>
                            {bluetoothStatus.debug && (
                                <div className="flex-group right debug">
                                    <input type="text" id="cmdTXT" value="" placeholder="命令" />
                                    <button 
                                        type="button" 
                                        className="primary" 
                                        onClick={() => {
                                            updateLog('发送命令功能开发中');
                                        }}
                                    >
                                        发送命令
                                    </button>
                                </div>
                            )}
                        </div>
                    </fieldset>

                    {/* Bluetooth Image Transfer */}
                    <fieldset>
                        <legend>蓝牙传图</legend>
                        <div className="flex-container">
                            <input 
                                type="file" 
                                id="imageFile" 
                                accept=".png,.jpg,.bmp,.webp,.jpeg" 
                                onChange={handleUpdateImage}
                            />
                        </div>
                        <div className="flex-container options">
                            <div className="flex-group">
                                <label htmlFor="ditherAlg">抖动算法:</label>
                                <select 
                                    id="ditherAlg" 
                                    value={canvasState.dithering}
                                    onChange={(e) => handleCanvasStateChange('dithering', e.target.value)}
                                >
                                    <option value="floydSteinberg">Floyd-Steinberg</option>
                                    <option value="atkinson">Atkinson</option>
                                    <option value="bayer">Bayer</option>
                                    <option value="stucki">Stucki</option>
                                    <option value="jarvis">Jarvis-Judice-Ninke</option>
                                    <option value="none">无抖动</option>
                                </select>
                            </div>
                            <div className="flex-group">
                                <label htmlFor="ditherStrength">抖动强度:</label>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="5" 
                                    step="0.1" 
                                    value={canvasState.strength}
                                    id="ditherStrength"
                                    onChange={(e) => handleCanvasStateChange('strength', parseFloat(e.target.value))}
                                />
                                <label id="ditherStrengthValue">{canvasState.strength.toFixed(1)}</label>
                            </div>
                            <div className="flex-group">
                                <label htmlFor="ditherContrast">对比度:</label>
                                <input 
                                    type="range" 
                                    min="0.5" 
                                    max="2" 
                                    step="0.1" 
                                    value={canvasState.contrast}
                                    id="ditherContrast"
                                    onChange={(e) => handleCanvasStateChange('contrast', parseFloat(e.target.value))}
                                />
                                <label id="ditherContrastValue">{canvasState.contrast.toFixed(1)}</label>
                            </div>
                            <div className="flex-group">
                                <label htmlFor="ditherMode">颜色模式:</label>
                                <select 
                                    id="ditherMode" 
                                    value={canvasState.colorPalette}
                                    onChange={(e) => handleCanvasStateChange('colorPalette', e.target.value as ColorPalette)}
                                >
                                    <option value="blackWhiteColor">双色(黑白)</option>
                                    <option value="threeColor">三色(黑白红)</option>
                                    <option value="fourColor">四色(黑白红黄)</option>
                                    <option value="sixColor">六色(黑白红黄蓝绿)</option>
                                </select>
                            </div>
                        </div>
                        <div className="status-bar"><b>状态：</b><span id="status">就绪</span></div>
                        
                        {/* Canvas Preview */}
                        <div style={{ 
                            margin: '16px 0', 
                            border: '1px solid var(--neon-red)', 
                            borderRadius: '4px', 
                            overflow: 'hidden',
                            background: 'white',
                            zIndex: '1',
                            position: 'relative'
                        }}>
                            <canvas 
                                id="bluetooth-canvas" 
                                ref={bluetoothCanvasRef} 
                                width={CANVAS_WIDTH} 
                                height={CANVAS_HEIGHT}
                                style={{ 
                                    width: '100%', 
                                    height: 'auto',
                                    display: 'block',
                                    zIndex: '2',
                                    position: 'relative'
                                }}
                            />
                        </div>
                        
                        <div className="flex-container">
                            <div className="flex-group">
                                <button 
                                    type="button" 
                                    className="secondary debug" 
                                    onClick={handleRotateCanvas}
                                >
                                    旋转画布
                                </button>
                                <button 
                                    type="button" 
                                    className="secondary" 
                                    onClick={handleClearCanvas}
                                >
                                    清除画布
                                </button>
                                <button 
                                    type="button" 
                                    className="primary" 
                                    onClick={handleSendImage}
                                >
                                    发送图片
                                </button>
                            </div>
                        </div>
                    </fieldset>


                </div>
            </SideDrawer>
        </div>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}