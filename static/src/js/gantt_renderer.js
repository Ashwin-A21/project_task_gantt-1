/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef, useState, onWillUpdateProps } from "@odoo/owl";

export class GanttRenderer extends Component {
    static template = "project_task_gantt.GanttRenderer";
    static props = {
        data: { type: Array },
        scale: { type: String },
    };

    setup() {
        this.root = useRef("root");
        this.canvasRef = useRef("ganttCanvas");
        this.containerRef = useRef("ganttContainer");
        
        this.state = useState({
            scrollX: 0,
            scrollY: 0,
            draggedTask: null,
            tooltip: { visible: false, content: '', x: 0, y: 0 },
            hoveredTask: null,
            zoom: 1.0,
        });

        // Base dimensions
        this.baseCellWidth = 40;
        this.baseCellHeight = 40;
        this.headerHeight = 80;
        this.sidebarWidth = 250;
        this.minCellWidth = 20;
        this.maxCellWidth = 100;

        this.animationFrame = null;
        this.lastDrawTime = 0;
        this.drawDelay = 16; // ~60fps

        onMounted(() => {
            this.setupCanvas();
            this.drawGantt();
            window.addEventListener('resize', this.handleResize.bind(this));
        });

        onWillUnmount(() => {
            window.removeEventListener('resize', this.handleResize.bind(this));
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
            }
        });

        onWillUpdateProps(() => {
            this.scheduleRedraw();
        });
    }

    get cellWidth() {
        return Math.max(this.minCellWidth, Math.min(this.maxCellWidth, this.baseCellWidth * this.state.zoom));
    }

    get cellHeight() {
        return this.baseCellHeight;
    }

    setupCanvas() {
        const canvas = this.canvasRef.el;
        const container = this.containerRef.el;
        if (!canvas || !container) return;

        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    handleResize() {
        this.setupCanvas();
        this.scheduleRedraw();
    }

    scheduleRedraw() {
        const now = Date.now();
        if (now - this.lastDrawTime >= this.drawDelay) {
            this.drawGantt();
            this.lastDrawTime = now;
        } else if (!this.animationFrame) {
            this.animationFrame = requestAnimationFrame(() => {
                this.animationFrame = null;
                this.drawGantt();
                this.lastDrawTime = Date.now();
            });
        }
    }

    drawGantt() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const data = this.props.data;
        const rect = canvas.getBoundingClientRect();
        
        ctx.clearRect(0, 0, rect.width, rect.height);

        if (!data || data.length === 0) {
            this.drawEmptyState(ctx, rect);
            return;
        }

        const dates = this.calculateDateRange(data);
        if (!dates.start || !dates.end) {
            this.drawEmptyState(ctx, rect);
            return;
        }

        // Draw in layers for better visual hierarchy
        this.drawGrid(ctx, dates, data, rect);
        this.drawTodayMarker(ctx, dates, rect);
        this.drawTasks(ctx, data, dates, rect);
        this.drawHeader(ctx, dates, rect);
        this.drawSidebar(ctx, data, rect);
    }

    drawEmptyState(ctx, rect) {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No tasks with start and end dates to display.', rect.width / 2, rect.height / 2);
    }

    calculateDateRange(data) {
        let minDate, maxDate;
        
        data.forEach(g => g.tasks.forEach(t => {
            const start = new Date(t.start_date);
            const end = new Date(t.end_date);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || end > maxDate) maxDate = end;
        }));

        if (!minDate || !maxDate) return { start: null, end: null };

        // Add padding to date range
        minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);

        return { start: minDate, end: maxDate };
    }

    drawGrid(ctx, dates, data, rect) {
        ctx.strokeStyle = '#e9e9e9';
        ctx.lineWidth = 1;

        const days = Math.ceil((dates.end - dates.start) / 86400000);

        // Vertical grid lines (dates)
        for (let i = 0; i <= days; i++) {
            const x = this.sidebarWidth + i * this.cellWidth - this.state.scrollX;
            if (x >= this.sidebarWidth && x <= rect.width) {
                ctx.beginPath();
                ctx.moveTo(x, this.headerHeight);
                ctx.lineTo(x, rect.height);
                ctx.stroke();
            }
        }

        // Horizontal grid lines (tasks)
        let totalRows = data.reduce((acc, g) => acc + Math.max(g.tasks.length, 1), 0);
        for (let i = 0; i <= totalRows; i++) {
            const y = this.headerHeight + i * this.cellHeight - this.state.scrollY;
            if (y >= this.headerHeight && y <= rect.height) {
                ctx.beginPath();
                ctx.moveTo(this.sidebarWidth, y);
                ctx.lineTo(rect.width, y);
                ctx.stroke();
            }
        }
    }

    drawTodayMarker(ctx, dates, rect) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (today >= dates.start && today <= dates.end) {
            const x = this.dateToX(today, dates);
            if (x >= this.sidebarWidth && x <= rect.width) {
                ctx.save();
                ctx.strokeStyle = '#e74c3c';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(x, this.headerHeight);
                ctx.lineTo(x, rect.height);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawHeader(ctx, dates, rect) {
        // Background
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, rect.width, this.headerHeight);
        
        ctx.strokeStyle = '#dee2e6';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, rect.width, this.headerHeight);

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.sidebarWidth, 0, rect.width - this.sidebarWidth, this.headerHeight);
        ctx.clip();

        // Draw months
        ctx.fillStyle = '#495057';
        ctx.font = 'bold 13px Arial';
        ctx.textBaseline = 'top';
        
        let current = new Date(dates.start);
        while (current <= dates.end) {
            const monthX = this.dateToX(current, dates);
            const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
            const monthEndX = this.dateToX(nextMonth, dates);
            
            if (monthEndX > this.sidebarWidth && monthX < rect.width) {
                const monthName = current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                const textWidth = ctx.measureText(monthName).width;
                const textX = Math.max(this.sidebarWidth + 5, monthX + 5);
                
                ctx.fillText(monthName, textX, 15);
            }
            
            current.setMonth(current.getMonth() + 1);
        }

        // Draw days
        ctx.font = '11px Arial';
        ctx.fillStyle = '#6c757d';
        
        let dayCounter = new Date(dates.start);
        const days = Math.ceil((dates.end - dates.start) / 86400000);
        
        for (let i = 0; i <= days; i++) {
            const dayX = this.dateToX(dayCounter, dates);
            if (dayX >= this.sidebarWidth && dayX < rect.width) {
                const isWeekend = dayCounter.getDay() === 0 || dayCounter.getDay() === 6;
                
                if (isWeekend) {
                    ctx.fillStyle = '#e9ecef';
                    ctx.fillRect(dayX, this.headerHeight, this.cellWidth, rect.height - this.headerHeight);
                    ctx.fillStyle = '#6c757d';
                }
                
                const day = dayCounter.getDate();
                const dayOfWeek = dayCounter.toLocaleDateString('en-US', { weekday: 'short' });
                
                ctx.fillText(day.toString(), dayX + 5, 45);
                ctx.fillText(dayOfWeek, dayX + 5, 60);
            }
            dayCounter.setDate(dayCounter.getDate() + 1);
        }

        ctx.restore();
    }

    drawSidebar(ctx, data, rect) {
        // Background
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, this.headerHeight, this.sidebarWidth, rect.height);
        
        ctx.strokeStyle = '#dee2e6';
        ctx.strokeRect(0, 0, this.sidebarWidth, rect.height);

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, this.headerHeight, this.sidebarWidth, rect.height - this.headerHeight);
        ctx.clip();

        ctx.fillStyle = '#495057';
        ctx.font = 'bold 12px Arial';
        ctx.textBaseline = 'middle';
        
        let y = this.headerHeight - this.state.scrollY;
        
        data.forEach(group => {
            const taskCount = Math.max(group.tasks.length, 1);
            const groupHeight = taskCount * this.cellHeight;
            const textY = y + groupHeight / 2;
            
            if (y + groupHeight > this.headerHeight && y < rect.height) {
                // Group background alternating color
                ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
                ctx.fillRect(0, Math.max(y, this.headerHeight), this.sidebarWidth, Math.min(groupHeight, rect.height - y));
                
                // Group name
                ctx.fillStyle = '#495057';
                const groupText = `${group.name} (${group.tasks.length})`;
                const truncated = this.truncateText(ctx, groupText, this.sidebarWidth - 20);
                ctx.fillText(truncated, 10, textY);
                
                // Separator line
                ctx.strokeStyle = '#dee2e6';
                ctx.beginPath();
                ctx.moveTo(0, y + groupHeight);
                ctx.lineTo(this.sidebarWidth, y + groupHeight);
                ctx.stroke();
            }
            
            y += groupHeight;
        });

        ctx.restore();
    }

    drawTasks(ctx, data, dates, rect) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.sidebarWidth, this.headerHeight, rect.width - this.sidebarWidth, rect.height - this.headerHeight);
        ctx.clip();

        let taskRow = 0;
        
        data.forEach(group => {
            if (group.tasks.length === 0) {
                taskRow++;
                return;
            }
            
            group.tasks.forEach(task => {
                const start = new Date(task.start_date);
                const end = new Date(task.end_date);
                const startX = this.dateToX(start, dates);
                const endX = this.dateToX(end, dates);
                const width = Math.max(endX - startX, 5);
                const y = this.headerHeight + (taskRow * this.cellHeight) + 6 - this.state.scrollY;
                const height = this.cellHeight - 12;

                if (y + this.cellHeight > this.headerHeight && y < rect.height) {
                    const isHovered = this.state.hoveredTask?.id === task.id;
                    const isDragged = this.state.draggedTask?.id === task.id;
                    
                    // Task bar shadow
                    if (isHovered || isDragged) {
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                        ctx.shadowBlur = 10;
                        ctx.shadowOffsetY = 3;
                    }
                    
                    // Task bar background
                    ctx.fillStyle = this.getTaskColor(task);
                    if (isDragged) {
                        ctx.globalAlpha = 0.7;
                    }
                    
                    this.roundRect(ctx, startX, y, width, height, 6, true, false);
                    
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetY = 0;
                    
                    // Progress bar
                    if (task.progress > 0) {
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                        const progressWidth = (width - 4) * (task.progress / 100);
                        this.roundRect(ctx, startX + 2, y + 2, progressWidth, height - 4, 4, true, false);
                    }
                    
                    // Task name
                    if (width > 40) {
                        ctx.fillStyle = '#ffffff';
                        ctx.font = isHovered ? 'bold 11px Arial' : '11px Arial';
                        ctx.textBaseline = 'middle';
                        const taskText = this.truncateText(ctx, task.name, width - 10);
                        ctx.fillText(taskText, startX + 6, y + height / 2);
                    }
                    
                    ctx.globalAlpha = 1.0;
                    
                    // Resize handles
                    if (isHovered) {
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#495057';
                        ctx.lineWidth = 1;
                        
                        // Left handle
                        ctx.beginPath();
                        ctx.arc(startX + 4, y + height / 2, 4, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                        
                        // Right handle
                        ctx.beginPath();
                        ctx.arc(startX + width - 4, y + height / 2, 4, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
                
                task._rect = { x: startX, y, width, height };
                taskRow++;
            });
        });

        ctx.restore();
    }

    roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    truncateText(ctx, text, maxWidth) {
        const width = ctx.measureText(text).width;
        if (width <= maxWidth) return text;
        
        const ellipsis = '...';
        const ellipsisWidth = ctx.measureText(ellipsis).width;
        let truncated = text;
        
        while (ctx.measureText(truncated).width + ellipsisWidth > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1);
        }
        
        return truncated + ellipsis;
    }

    getTaskColor(task) {
        const colors = [
            '#875a7b', '#f06050', '#f4a460', '#6cc1ed', 
            '#d6145f', '#30c381', '#9c27b0', '#ff9800'
        ];
        return colors[task.color % colors.length] || '#875a7b';
    }

    getTaskAt(x, y) {
        for (const group of this.props.data) {
            for (const task of group.tasks) {
                if (task._rect && 
                    x >= task._rect.x && 
                    x <= task._rect.x + task._rect.width &&
                    y >= task._rect.y && 
                    y <= task._rect.y + task._rect.height) {
                    return task;
                }
            }
        }
        return null;
    }

    dateToX(date, dates) {
        const days = (date - dates.start) / 86400000;
        return this.sidebarWidth + days * this.cellWidth - this.state.scrollX;
    }

    xToDate(x, dates) {
        const days = (x - this.sidebarWidth + this.state.scrollX) / this.cellWidth;
        return new Date(dates.start.getTime() + days * 86400000);
    }

    dispatchEvent(name, detail) {
        this.root.el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }

    onMouseDown(e) {
        const rect = this.canvasRef.el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const task = this.getTaskAt(x, y);
        
        if (task) {
            this.state.draggedTask = {
                ...task,
                startX: e.clientX,
                originalStart: new Date(task.start_date),
                originalEnd: new Date(task.end_date),
            };
            this.state.tooltip.visible = false;
            this.canvasRef.el.style.cursor = 'grabbing';
        }
    }

    onMouseMove(e) {
        const rect = this.canvasRef.el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.state.draggedTask) {
            const deltaX = e.clientX - this.state.draggedTask.startX;
            const daysDelta = Math.round(deltaX / this.cellWidth);
            const msDelta = daysDelta * 86400000;
            
            const newStartDate = new Date(this.state.draggedTask.originalStart.getTime() + msDelta);
            const newEndDate = new Date(this.state.draggedTask.originalEnd.getTime() + msDelta);
            
            const taskInUI = this.props.data
                .flatMap(g => g.tasks)
                .find(t => t.id === this.state.draggedTask.id);
            
            if (taskInUI) {
                taskInUI.start_date = newStartDate.toISOString();
                taskInUI.end_date = newEndDate.toISOString();
                this.scheduleRedraw();
            }
        } else {
            const task = this.getTaskAt(x, y);
            this.state.hoveredTask = task;
            
            if (task) {
                const startDate = new Date(task.start_date).toLocaleDateString();
                const endDate = new Date(task.end_date).toLocaleDateString();
                const duration = ((new Date(task.end_date) - new Date(task.start_date)) / 86400000).toFixed(1);
                
                this.state.tooltip = {
                    visible: true,
                    content: `${task.name}\nStart: ${startDate}\nEnd: ${endDate}\nDuration: ${duration} days\nProgress: ${task.progress}%`,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                };
                this.canvasRef.el.style.cursor = 'grab';
            } else {
                this.state.tooltip.visible = false;
                this.canvasRef.el.style.cursor = 'default';
            }
            
            this.scheduleRedraw();
        }
    }

    onMouseUp(e) {
        if (this.state.draggedTask) {
            const task = this.props.data
                .flatMap(g => g.tasks)
                .find(t => t.id === this.state.draggedTask.id);
            
            if (task) {
                this.dispatchEvent('task-updated', {
                    taskId: task.id,
                    startDate: task.start_date,
                    endDate: task.end_date,
                });
            }
            
            this.state.draggedTask = null;
            this.canvasRef.el.style.cursor = 'default';
        }
    }

    onDoubleClick(e) {
        const rect = this.canvasRef.el.getBoundingClientRect();
        const task = this.getTaskAt(e.clientX - rect.left, e.clientY - rect.top);
        
        if (task) {
            this.dispatchEvent('task-clicked', { taskId: task.id });
        }
    }

    onWheel(e) {
        e.preventDefault();
        
        if (e.ctrlKey || e.metaKey) {
            // Zoom with Ctrl/Cmd + wheel
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            this.state.zoom = Math.max(0.5, Math.min(2.0, this.state.zoom * zoomDelta));
        } else {
            // Regular scrolling
            this.state.scrollX = Math.max(0, this.state.scrollX + e.deltaX);
            this.state.scrollY = Math.max(0, this.state.scrollY + e.deltaY);
        }
        
        this.scheduleRedraw();
    }

    onMouseLeave() {
        this.state.draggedTask = null;
        this.state.tooltip.visible = false;
        this.state.hoveredTask = null;
        this.canvasRef.el.style.cursor = 'default';
        this.scheduleRedraw();
    }
}