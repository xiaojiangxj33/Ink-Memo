/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CanvasState, DitherAlgorithm, DitherMode, DotSegment, LineSegment as LineSegmentType, TextElement, ToolType } from './types';
import { adjustContrast, ditherImage, processImageData } from './dithering';

export class PaintManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private painting: boolean = false;
  private lastX: number = 0;
  private lastY: number = 0;
  private brushColor: string = "#000000";
  private brushSize: number = 2;
  private currentTool: ToolType = null;
  private textElements: TextElement[] = [];
  private lineSegments: (DotSegment | LineSegmentType)[] = [];
  private isTextPlacementMode: boolean = false;
  private draggingCanvasContext: ImageData | null = null;
  private selectedTextElement: TextElement | null = null;
  private isDraggingText: boolean = false;
  private dragOffsetX: number = 0;
  private dragOffsetY: number = 0;
  private textBold: boolean = false;
  private textItalic: boolean = false;

  // Brush cursor indicator
  private brushCursor: HTMLDivElement | null = null;

  // Undo/Redo functionality
  private historyStack: CanvasState[] = [];
  private historyStep: number = -1;
  private readonly MAX_HISTORY: number = 50;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;

    // Bind event handlers
    this.startPaint = this.startPaint.bind(this);
    this.paint = this.paint.bind(this);
    this.endPaint = this.endPaint.bind(this);
    this.handleCanvasClick = this.handleCanvasClick.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.handleKeyboard = this.handleKeyboard.bind(this);
    this.updateBrushCursor = this.updateBrushCursor.bind(this);
    this.hideBrushCursor = this.hideBrushCursor.bind(this);
  }

  /**
   * Initialize paint tools event listeners
   */
  initPaintTools(): void {
    const brushModeBtn = document.getElementById('brush-mode');
    const eraserModeBtn = document.getElementById('eraser-mode');
    const textModeBtn = document.getElementById('text-mode');
    const brushColorSelect = document.getElementById('brush-color');
    const brushSizeInput = document.getElementById('brush-size');
    const addTextBtn = document.getElementById('add-text-btn');
    const textBoldBtn = document.getElementById('text-bold');
    const textItalicBtn = document.getElementById('text-italic');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (brushModeBtn) {
      brushModeBtn.addEventListener('click', () => {
        if (this.currentTool === 'brush') {
          this.setActiveTool(null, '');
        } else {
          this.setActiveTool('brush', '画笔模式');
          this.brushColor = brushColorSelect?.value || '#000000';
        }
      });
    }

    if (eraserModeBtn) {
      eraserModeBtn.addEventListener('click', () => {
        if (this.currentTool === 'eraser') {
          this.setActiveTool(null, '');
        } else {
          this.setActiveTool('eraser', '橡皮擦');
          this.brushColor = "#FFFFFF";
        }
      });
    }

    if (textModeBtn) {
      textModeBtn.addEventListener('click', () => {
        if (this.currentTool === 'text') {
          this.setActiveTool(null, '');
        } else {
          this.setActiveTool('text', '插入文字');
          this.brushColor = brushColorSelect?.value || '#000000';
        }
      });
    }

    if (brushColorSelect) {
      brushColorSelect.addEventListener('change', (e) => {
        this.brushColor = (e.target as HTMLSelectElement).value;
      });
    }

    if (brushSizeInput) {
      brushSizeInput.addEventListener('input', (e) => {
        this.brushSize = parseInt((e.target as HTMLInputElement).value);
        this.updateBrushCursorSize();
      });
    }

    if (addTextBtn) {
      addTextBtn.addEventListener('click', () => this.startTextPlacement());
    }

    // Add event listeners for bold and italic buttons
    if (textBoldBtn) {
      textBoldBtn.addEventListener('click', () => {
        this.textBold = !this.textBold;
        textBoldBtn.classList.toggle('primary', this.textBold);
      });
    }

    if (textItalicBtn) {
      textItalicBtn.addEventListener('click', () => {
        this.textItalic = !this.textItalic;
        textItalicBtn.classList.toggle('primary', this.textItalic);
      });
    }

    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undo());
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', () => this.redo());
    }

    // Canvas event listeners
    this.canvas.addEventListener('mousedown', this.startPaint);
    this.canvas.addEventListener('mousemove', this.paint);
    this.canvas.addEventListener('mouseup', this.endPaint);
    this.canvas.addEventListener('mouseleave', this.endPaint);
    this.canvas.addEventListener('click', this.handleCanvasClick);
    this.canvas.addEventListener('touchstart', this.onTouchStart);
    this.canvas.addEventListener('touchmove', this.onTouchMove);
    this.canvas.addEventListener('touchend', this.onTouchEnd);
    this.canvas.addEventListener('mouseenter', this.updateBrushCursor);
    this.canvas.addEventListener('mousemove', this.updateBrushCursor);

    // Keyboard event listener
    document.addEventListener('keydown', this.handleKeyboard);

    // Create brush cursor
    this.createBrushCursor();

    // Initialize history with blank canvas state
    this.saveToHistory();
  }

  /**
   * Save current canvas state to history
   */
  saveToHistory(): void {
    // Remove any states after current step (when user drew something after undoing)
    this.historyStack = this.historyStack.slice(0, this.historyStep + 1);

    // Save current canvas state along with text and line data
    const canvasState: CanvasState = {
      imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height),
      textElements: JSON.parse(JSON.stringify(this.textElements)),
      lineSegments: JSON.parse(JSON.stringify(this.lineSegments))
    };

    this.historyStack.push(canvasState);
    this.historyStep++;

    // Limit history size
    if (this.historyStack.length > this.MAX_HISTORY) {
      this.historyStack.shift();
      this.historyStep--;
    }

    this.updateUndoRedoButtons();
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.historyStack = [];
    this.historyStep = -1;
    this.updateUndoRedoButtons();
  }

  /**
   * Undo last action
   */
  undo(): void {
    if (this.historyStep > 0) {
      this.historyStep--;
      this.restoreFromHistory();
    }
  }

  /**
   * Redo last undone action
   */
  redo(): void {
    if (this.historyStep < this.historyStack.length - 1) {
      this.historyStep++;
      this.restoreFromHistory();
    }
  }

  /**
   * Restore canvas state from history
   */
  restoreFromHistory(): void {
    if (this.historyStep >= 0 && this.historyStep < this.historyStack.length) {
      const state = this.historyStack[this.historyStep];

      // Restore canvas image
      this.ctx.putImageData(state.imageData, 0, 0);

      // Restore text and line data
      this.textElements = JSON.parse(JSON.stringify(state.textElements));
      this.lineSegments = JSON.parse(JSON.stringify(state.lineSegments));

      this.updateUndoRedoButtons();
    }
  }

  /**
   * Update undo/redo button states
   */
  updateUndoRedoButtons(): void {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) {
      undoBtn.disabled = this.historyStep <= 0;
    }

    if (redoBtn) {
      redoBtn.disabled = this.historyStep >= this.historyStack.length - 1;
    }
  }

  /**
   * Set active tool
   */
  setActiveTool(tool: ToolType, title: string): void {
    this.setCanvasTitle(title);
    this.currentTool = tool;

    const canvasContainer = this.canvas.parentNode as HTMLElement;
    canvasContainer.classList.toggle('brush-mode', this.currentTool === 'brush');
    canvasContainer.classList.toggle('eraser-mode', this.currentTool === 'eraser');
    canvasContainer.classList.toggle('text-mode', this.currentTool === 'text');

    const brushModeBtn = document.getElementById('brush-mode');
    const eraserModeBtn = document.getElementById('eraser-mode');
    const textModeBtn = document.getElementById('text-mode');
    const brushColorSelect = document.getElementById('brush-color');
    const brushSizeInput = document.getElementById('brush-size');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (brushModeBtn) {
      brushModeBtn.classList.toggle('active', this.currentTool === 'brush');
    }
    if (eraserModeBtn) {
      eraserModeBtn.classList.toggle('active', this.currentTool === 'eraser');
    }
    if (textModeBtn) {
      textModeBtn.classList.toggle('active', this.currentTool === 'text');
    }

    if (brushColorSelect) {
      brushColorSelect.disabled = this.currentTool === 'eraser';
    }
    if (brushSizeInput) {
      brushSizeInput.disabled = this.currentTool === 'text';
    }

    if (undoBtn) {
      undoBtn.classList.toggle('hide', this.currentTool === null);
    }
    if (redoBtn) {
      redoBtn.classList.toggle('hide', this.currentTool === null);
    }

    // Cancel any pending text placement
    this.cancelTextPlacement();
  }

  /**
   * Set tool (simplified version for external calls)
   */
  setTool(tool: ToolType): void {
    this.setActiveTool(tool, tool === 'brush' ? '画笔模式' : tool === 'eraser' ? '橡皮擦' : '文字模式');
  }

  /**
   * Set brush color
   */
  setBrushColor(color: string): void {
    this.brushColor = color;
  }

  /**
   * Set brush size
   */
  setBrushSize(size: number): void {
    this.brushSize = size;
    this.updateBrushCursorSize();
  }

  /**
   * Create brush cursor element
   */
  createBrushCursor(): void {
    // Create a div element to show as brush cursor
    this.brushCursor = document.createElement('div');
    this.brushCursor.id = 'brush-cursor';
    this.brushCursor.style.position = 'fixed';
    this.brushCursor.style.border = '2px solid rgba(0, 0, 0, 0.5)';
    this.brushCursor.style.borderRadius = '50%';
    this.brushCursor.style.pointerEvents = 'none';
    this.brushCursor.style.display = 'none';
    this.brushCursor.style.zIndex = '10000';
    this.brushCursor.style.transform = 'translate(-50%, -50%)';
    this.brushCursor.style.willChange = 'transform';
    this.brushCursor.style.left = '0';
    this.brushCursor.style.top = '0';
    document.body.appendChild(this.brushCursor);
    this.updateBrushCursorSize();

    // For requestAnimationFrame throttling
    this.cursorUpdateScheduled = false;
    this.pendingCursorX = 0;
    this.pendingCursorY = 0;
  }

  // For requestAnimationFrame throttling
  private cursorUpdateScheduled: boolean = false;
  private pendingCursorX: number = 0;
  private pendingCursorY: number = 0;

  /**
   * Update brush cursor size
   */
  updateBrushCursorSize(): void {
    if (!this.brushCursor) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.canvas.width;
    const scaleY = rect.height / this.canvas.height;
    const scale = Math.min(scaleX, scaleY);

    const size = this.brushSize * scale;
    this.brushCursor.style.width = size + 'px';
    this.brushCursor.style.height = size + 'px';
  }

  /**
   * Update brush cursor position
   */
  updateBrushCursor(e: MouseEvent): void {
    if (!this.brushCursor) return;

    if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
      // Check if mouse is within canvas bounds
      const rect = this.canvas.getBoundingClientRect();
      const isInCanvas = e.clientX >= rect.left && 
                         e.clientX <= rect.right && 
                         e.clientY >= rect.top && 
                         e.clientY <= rect.bottom;

      if (isInCanvas) {
        this.brushCursor.style.display = 'block';
        this.canvas.style.cursor = 'none';

        // Store the pending position
        this.pendingCursorX = e.clientX;
        this.pendingCursorY = e.clientY;

        // Schedule update using requestAnimationFrame for smooth movement
        if (!this.cursorUpdateScheduled) {
          this.cursorUpdateScheduled = true;
          requestAnimationFrame(() => {
            this.brushCursor!.style.transform = `translate(${this.pendingCursorX}px, ${this.pendingCursorY}px) translate(-50%, -50%)`;
            this.cursorUpdateScheduled = false;
          });
        }

        // Update color to match brush or show white for eraser (only needs to happen once or when tool changes)
        if (this.currentTool === 'eraser') {
          if (this.brushCursor.getAttribute('data-tool') !== 'eraser') {
            this.brushCursor.style.border = '2px solid rgba(255, 0, 0, 0.7)';
            this.brushCursor.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            this.brushCursor.style.boxShadow = 'none';
            this.brushCursor.setAttribute('data-tool', 'eraser');
          }
        } else {
          if (this.brushCursor.getAttribute('data-tool') !== 'brush') {
            // Use a contrasting border - white with black outline for visibility
            this.brushCursor.style.border = '1px solid white';
            this.brushCursor.style.boxShadow = '0 0 0 1px black, inset 0 0 0 1px black';
            this.brushCursor.style.backgroundColor = 'transparent';
            this.brushCursor.setAttribute('data-tool', 'brush');
          }
        }
      } else {
        // Hide cursor when outside canvas
        this.hideBrushCursor();
      }
    }
  }

  /**
   * Hide brush cursor
   */
  hideBrushCursor(): void {
    if (this.brushCursor) {
      this.brushCursor.style.display = 'none';
    }
    this.canvas.style.cursor = 'default';
  }

  /**
   * Start painting
   */
  startPaint(e: MouseEvent): void {
    if (!this.currentTool) return;

    if (this.currentTool === 'text') {
      // Check if we're clicking on a text element to drag
      const textElement = this.findTextElementAt(e);
      if (textElement && textElement === this.selectedTextElement) {
        this.isDraggingText = true;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // Calculate offset for smooth dragging
        this.dragOffsetX = textElement.x - x;
        this.dragOffsetY = textElement.y - y;

        return; // Don't start drawing
      }
    } else {
      this.painting = true;
      this.draw(e);
    }
  }

  /**
   * End painting
   */
  endPaint(): void {
    if (this.painting || this.isDraggingText) {
      this.saveToHistory(); // Save state after drawing or dragging text
    }
    this.painting = false;
    this.isDraggingText = false;
    this.lastX = 0;
    this.lastY = 0;

    this.hideBrushCursor();
  }

  /**
   * Paint on canvas
   */
  paint(e: MouseEvent): void {
    if (!this.currentTool) return;

    if (this.currentTool === 'text') {
      if (this.isDraggingText && this.selectedTextElement) {
        this.dragText(e);
      }
    } else {
      if (this.painting) {
        this.draw(e);
      }
    }
  }

  /**
   * Draw on canvas
   */
  draw(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    this.ctx.strokeStyle = this.brushColor;
    this.ctx.lineWidth = this.brushSize;

    this.ctx.beginPath();

    if (this.lastX === 0 && this.lastY === 0) {
      // For the first point, just do a dot
      this.ctx.moveTo(x, y);
      this.ctx.lineTo(x + 0.1, y + 0.1);

      // Store the dot for redrawing
      this.lineSegments.push({
        type: 'dot',
        x: x,
        y: y,
        color: this.brushColor,
        size: this.brushSize
      });
    } else {
      // Connect to the previous point
      this.ctx.moveTo(this.lastX, this.lastY);
      this.ctx.lineTo(x, y);

      // Store the line segment for redrawing
      this.lineSegments.push({
        type: 'line',
        x1: this.lastX,
        y1: this.lastY,
        x2: x,
        y2: y,
        color: this.brushColor,
        size: this.brushSize
      });
    }

    this.ctx.stroke();

    this.lastX = x;
    this.lastY = y;
  }

  /**
   * Handle canvas click
   */
  handleCanvasClick(e: MouseEvent): void {
    if (this.currentTool === 'text' && this.isTextPlacementMode) {
      this.placeText(e);
    }
  }

  /**
   * Handle touch start event
   */
  onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    const touch = e.touches[0];

    // If in text placement mode, handle as a click
    if (this.currentTool === 'text' && this.isTextPlacementMode) {
      const mouseEvent = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
      return;
    }

    // Otherwise handle as normal drawing
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.canvas.dispatchEvent(mouseEvent);
  }

  /**
   * Handle touch move event
   */
  onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.canvas.dispatchEvent(mouseEvent);
  }

  /**
   * Handle touch end event
   */
  onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this.endPaint();
  }

  /**
   * Drag text element
   */
  dragText(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Update text position with offset
    this.selectedTextElement!.x = x + this.dragOffsetX;
    this.selectedTextElement!.y = y + this.dragOffsetY;

    // Redraw selected text element
    if (this.draggingCanvasContext) {
      this.ctx.putImageData(this.draggingCanvasContext, 0, 0);
    } else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.ctx.font = this.selectedTextElement!.font;
    this.ctx.fillStyle = this.selectedTextElement!.color;
    this.ctx.fillText(this.selectedTextElement!.text, this.selectedTextElement!.x, this.selectedTextElement!.y);
  }

  /**
   * Find text element at mouse position
   */
  findTextElementAt(e: MouseEvent): TextElement | null {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Search through text elements in reverse order (top-most first)
    for (let i = this.textElements.length - 1; i >= 0; i--) {
      const text = this.textElements[i];

      // Calculate text dimensions
      this.ctx.font = text.font;
      const textWidth = this.ctx.measureText(text.text).width;

      // Extract font size correctly from the font string
      const fontSizeMatch = text.font.match(/(\d+)px/);
      const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 14;
      const textHeight = fontSize * 1.2; // Approximate height

      // Check if click is within text bounds (allowing for some margin)
      const margin = 5;
      if (x >= text.x - margin &&
        x <= text.x + textWidth + margin &&
        y >= text.y - textHeight + margin &&
        y <= text.y + margin) {
        return text;
      }
    }

    return null;
  }

  /**
   * Start text placement mode
   */
  startTextPlacement(): void {
    const textInput = document.getElementById('text-input') as HTMLInputElement;
    if (!textInput) return;
    
    const text = textInput.value.trim();
    if (!text) {
      alert('请输入文字内容');
      return;
    }

    this.isTextPlacementMode = true;

    // Add visual feedback
    this.setCanvasTitle('点击画布放置文字');
    this.canvas.classList.add('text-placement-mode');
  }

  /**
   * Cancel text placement mode
   */
  cancelTextPlacement(): void {
    this.isTextPlacementMode = false;
    this.canvas.classList.remove('text-placement-mode');

    // reset dragging state
    this.isDraggingText = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.selectedTextElement = null;
    this.draggingCanvasContext = null;
  }

  /**
   * Place text on canvas
   */
  placeText(e: MouseEvent): void {
    const textInput = document.getElementById('text-input') as HTMLInputElement;
    if (!textInput) return;
    
    const fontFamilySelect = document.getElementById('font-family') as HTMLSelectElement;
    const fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
    
    const text = textInput.value;
    const fontFamily = fontFamilySelect?.value || 'Arial';
    const fontSize = fontSizeInput?.value || '16';

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Build font style string
    let fontStyle = '';
    if (this.textItalic) fontStyle += 'italic ';
    if (this.textBold) fontStyle += 'bold ';

    // Create a new text element
    const newText: TextElement = {
      text: text,
      x: x,
      y: y,
      font: `${fontStyle}${fontSize}px ${fontFamily}`,
      color: this.brushColor
    };

    // Add to our list of text elements
    this.textElements.push(newText);

    // Select this text element for immediate dragging
    this.selectedTextElement = newText;
    this.draggingCanvasContext = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    // Draw text on canvas
    this.ctx.font = newText.font;
    this.ctx.fillStyle = newText.color;
    this.ctx.fillText(newText.text, newText.x, newText.y);

    // Save to history after placing text
    this.saveToHistory();

    // Reset
    textInput.value = '';
    this.isTextPlacementMode = false;
    this.canvas.classList.remove('text-placement-mode');
    this.setCanvasTitle('拖动新添加文字可调整位置');
  }

  /**
   * Redraw all text elements after dithering
   */
  redrawTextElements(): void {
    // Redraw all text elements after dithering
    this.textElements.forEach(item => {
      this.ctx.font = item.font;
      this.ctx.fillStyle = item.color;
      this.ctx.fillText(item.text, item.x, item.y);
    });
  }

  /**
   * Redraw all line segments after dithering
   */
  redrawLineSegments(): void {
    // Redraw all line segments after dithering
    this.lineSegments.forEach(segment => {
      this.ctx.lineJoin = 'round';
      this.ctx.lineCap = 'round';
      this.ctx.strokeStyle = segment.color;
      this.ctx.lineWidth = segment.size;
      this.ctx.beginPath();

      if (segment.type === 'dot') {
        this.ctx.moveTo(segment.x, segment.y);
        this.ctx.lineTo(segment.x + 0.1, segment.y + 0.1);
      } else {
        this.ctx.moveTo(segment.x1, segment.y1);
        this.ctx.lineTo(segment.x2, segment.y2);
      }

      this.ctx.stroke();
    });
  }

  /**
   * Clear text elements and line segments
   */
  clearElements(): void {
    this.textElements = [];
    this.lineSegments = [];
  }

  /**
   * Set canvas title
   */
  setCanvasTitle(title: string): void {
    const canvasTitle = document.querySelector('.canvas-title');
    if (canvasTitle) {
      canvasTitle.textContent = title;
      canvasTitle.style.display = title && title !== '' ? 'block' : 'none';
    }
  }

  /**
   * Handle keyboard events
   */
  handleKeyboard(e: KeyboardEvent): void {
    // Ctrl+Z or Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z or Cmd+Shift+Z for redo
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      this.redo();
    }
  }
}

export class CropManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paintManager?: PaintManager;
  private isCropMode: boolean = false;
  private scale: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private isDragging: boolean = false;
  private startX: number = 0;
  private startY: number = 0;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, paintManager?: PaintManager) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.paintManager = paintManager;
  }

  /**
   * Initialize crop tools event listeners
   */
  initCropTools(): void {
    const cropZoomInBtn = document.getElementById('crop-zoom-in');
    const cropZoomOutBtn = document.getElementById('crop-zoom-out');
    const cropMoveLeftBtn = document.getElementById('crop-move-left');
    const cropMoveUpBtn = document.getElementById('crop-move-up');
    const cropMoveDownBtn = document.getElementById('crop-move-down');
    const cropMoveRightBtn = document.getElementById('crop-move-right');

    if (cropZoomInBtn) {
      cropZoomInBtn.addEventListener('click', () => this.zoom(0.1));
    }
    if (cropZoomOutBtn) {
      cropZoomOutBtn.addEventListener('click', () => this.zoom(-0.1));
    }
    if (cropMoveLeftBtn) {
      cropMoveLeftBtn.addEventListener('click', () => this.move(-10, 0));
    }
    if (cropMoveUpBtn) {
      cropMoveUpBtn.addEventListener('click', () => this.move(0, -10));
    }
    if (cropMoveDownBtn) {
      cropMoveDownBtn.addEventListener('click', () => this.move(0, 10));
    }
    if (cropMoveRightBtn) {
      cropMoveRightBtn.addEventListener('click', () => this.move(10, 0));
    }
  }

  /**
   * Check if in crop mode
   */
  isCropModeActive(): boolean {
    return this.isCropMode;
  }

  /**
   * Initialize crop mode
   */
  initializeCrop(): void {
    this.isCropMode = true;
    this.canvas.parentNode?.classList.add('crop-mode');
    this.canvas.style.cursor = 'grab';
  }

  /**
   * Exit crop mode
   */
  exitCropMode(): void {
    this.isCropMode = false;
    this.canvas.parentNode?.classList.remove('crop-mode');
    this.canvas.style.cursor = 'default';
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Zoom in/out
   */
  zoom(delta: number): void {
    this.scale = Math.max(0.1, Math.min(3, this.scale + delta));
    this.redrawCanvas();
  }

  /**
   * Move canvas
   */
  move(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.redrawCanvas();
  }

  /**
   * Redraw canvas with current scale and offset
   */
  redrawCanvas(): void {
    // Save current image data
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    
    // Clear canvas
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw image with scale and offset
    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);
    this.ctx.putImageData(imageData, 0, 0);
    this.ctx.restore();
    
    // Redraw text and line segments if paintManager is available
    if (this.paintManager) {
      this.paintManager.redrawTextElements();
      this.paintManager.redrawLineSegments();
    }
  }

  /**
   * Finish crop and apply changes
   */
  finishCrop(callback?: () => void): void {
    // Capture current canvas state
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    
    // Exit crop mode
    this.exitCropMode();
    
    // Redraw original image
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.putImageData(imageData, 0, 0);
    
    // Call callback if provided
    if (callback) {
      callback();
    }
  }
}

/**
 * Update canvas size
 */
export function updateCanvasSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.width = width;
  canvas.height = height;
  
  // Fill with white after resizing
  fillCanvas(canvas, 'white');
}

/**
 * Update image on canvas
 */
export function updateImage(canvas: HTMLCanvasElement, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!file) {
      fillCanvas(canvas, 'white');
      resolve();
      return;
    }

    const image = new Image();
    image.onload = function () {
      URL.revokeObjectURL(this.src);
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取画布上下文'));
        return;
      }
      
      // Fill with white first
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw image at original size, centered
      const offsetX = (canvas.width - image.width) / 2;
      const offsetY = (canvas.height - image.height) / 2;
      
      // Draw image - if it's too large, scale it down to fit
      if (image.width > canvas.width || image.height > canvas.height) {
        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;
        const centerX = (canvas.width - scaledWidth) / 2;
        const centerY = (canvas.height - scaledHeight) / 2;
        ctx.drawImage(image, centerX, centerY, scaledWidth, scaledHeight);
      } else {
        ctx.drawImage(image, offsetX, offsetY);
      }
      
      // 不在这里应用抖动，由useEffect监听canvasState变化来自动应用
      resolve();
    };
    image.onerror = function () {
      URL.revokeObjectURL(this.src);
      reject(new Error('图片加载失败'));
    };
    image.src = URL.createObjectURL(file);
  });
}

/**
 * Fill canvas with specified color
 */
export function fillCanvas(canvas: HTMLCanvasElement, style: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Convert image with dithering
 */
export function convertDithering(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Get paint manager instance from somewhere (this would need to be refactored in a real app)
  // For now, we'll just redraw text and line segments
  
  // For now, we'll use default values since we don't have direct access to the form elements
  // In a real app, these values would be passed as parameters
  const contrast = 1.2;
  const alg = 'floydSteinberg';
  const strength = 1.0;
  const mode = 'blackWhiteColor';
  
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, contrast);

  const ditheredImageData = ditherImage(imageData, alg as DitherAlgorithm, strength, mode as DitherMode);
  const processedData = processImageData(ditheredImageData, mode as DitherMode);
  
  // This would normally decode the processed data back to an ImageData and draw it
  // For now, we'll just draw the dithered image directly
  ctx.putImageData(ditheredImageData, 0, 0);
}

/**
 * Apply dithering to image
 */
export function applyDither(canvas: HTMLCanvasElement, canvasState: CanvasState): void {
  // This would normally call cropManager.finishCrop(() => convertDithering());
  // For now, we'll just call convertDithering directly with the provided canvas state
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, canvasState.contrast);

  const ditheredImageData = ditherImage(
    imageData, 
    canvasState.dithering as DitherAlgorithm, 
    canvasState.strength, 
    canvasState.colorPalette as DitherMode
  );
  const processedData = processImageData(ditheredImageData, canvasState.colorPalette as DitherMode);
  
  ctx.putImageData(ditheredImageData, 0, 0);
}

/**
 * Rotate canvas
 */
export function rotateCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;

  // Capture current canvas content
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  // Swap canvas dimensions
  canvas.width = currentHeight;
  canvas.height = currentWidth;

  // Create temporary canvas for rotation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCtx.putImageData(imageData, 0, 0);

  // Draw rotated image on the resized canvas
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  // Clear history as canvas size changed
  // This would normally call paintManager.clearHistory();
  // For now, we'll just save to history
  
  // Clear stored text positions and line segments
  // This would normally call paintManager.clearElements();
  
  // Save rotated canvas to history
  // This would normally call paintManager.saveToHistory();
}

/**
 * Clear canvas
 */
export function clearCanvas(canvas: HTMLCanvasElement): boolean {
  if (confirm('清除画布内容?')) {
    fillCanvas(canvas, 'white');
    // This would normally call paintManager.clearElements();
    // For now, we'll just fill the canvas
    return true;
  }
  return false;
}
