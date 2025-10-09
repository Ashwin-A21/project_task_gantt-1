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
        });

        this.cellWidth = 40;
        this.cellHeight = 40;
        this.headerHeight = 60;
        this.sidebarWidth = 200;

        onMounted(() => {
            this.setupCanvas();
            this.drawGantt();
            window.addEventListener('resize', this.handleResize.bind(this));
        });

        onWillUnmount(() => window.removeEventListener('resize', this.handleResize.bind(this)));
        onWillUpdateProps(() => this.drawGantt());
    }

    setupCanvas() {
        const canvas = this.canvasRef.el;
        const container = this.containerRef.el;
        if (!canvas || !container) return;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    handleResize() {
        this.setupCanvas();
        this.drawGantt();
    }

    drawGantt() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.props.data;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!data || data.length === 0) {
            ctx.font = '16px Arial';
            ctx.fillStyle = '#aaa';
            ctx.textAlign = 'center';
            ctx.fillText('No tasks with start and end dates to display.', canvas.width / 2, canvas.height / 2);
            return;
        }
        const dates = this.calculateDateRange(data);
        if (!dates.start || !dates.end) return;
        this.drawGrid(ctx, dates, data);
        this.drawHeader(ctx, dates);
        this.drawSidebar(ctx, data);
        this.drawTasks(ctx, data, dates);
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
        minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);
        return { start: minDate, end: maxDate };
    }

    drawGrid(ctx, dates, data) {
        const canvas = this.canvasRef.el;
        ctx.strokeStyle = '#e9e9e9';
        ctx.lineWidth = 1;
        const days = Math.ceil((dates.end - dates.start) / 86400000);
        for (let i = 0; i <= days; i++) {
            const x = this.sidebarWidth + i * this.cellWidth - this.state.scrollX;
            if (x >= this.sidebarWidth && x <= canvas.width) {
                ctx.beginPath();
                ctx.moveTo(x, this.headerHeight);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
        }
        let totalRows = data.reduce((acc, g) => acc + (g.tasks.length || 1), 0);
        for (let i = 0; i <= totalRows; i++) {
            const y = this.headerHeight + i * this.cellHeight - this.state.scrollY;
            if (y >= this.headerHeight && y <= canvas.height) {
                ctx.beginPath();
                ctx.moveTo(this.sidebarWidth, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        }
    }

    drawHeader(ctx, dates) {
        const canvas = this.canvasRef.el;
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, canvas.width, this.headerHeight);
        ctx.strokeStyle = '#e9e9e9';
        ctx.strokeRect(0, 0, canvas.width, this.headerHeight);
        ctx.fillStyle = '#4c4c4c';
        ctx.font = 'bold 12px Arial';
        let current = new Date(dates.start);
        while (current <= dates.end) {
            const monthX = this.dateToX(current, dates);
            if (monthX < canvas.width && monthX + 100 > this.sidebarWidth) {
                ctx.fillText(current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), monthX + 5, 25);
            }
            current.setMonth(current.getMonth() + 1);
        }
        ctx.font = '10px Arial';
        let dayCounter = new Date(dates.start);
        const days = Math.ceil((dates.end - dates.start) / 86400000);
        for (let i = 0; i <= days; i++) {
            const dayX = this.dateToX(dayCounter, dates);
            if (dayX >= this.sidebarWidth && dayX < canvas.width) {
                ctx.fillText(dayCounter.getDate(), dayX + 5, 45);
            }
            dayCounter.setDate(dayCounter.getDate() + 1);
        }
    }

    drawSidebar(ctx, data) {
        const canvas = this.canvasRef.el;
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, this.headerHeight, this.sidebarWidth, canvas.height);
        ctx.strokeStyle = '#e9e9e9';
        ctx.strokeRect(0, 0, this.sidebarWidth, canvas.height);
        ctx.fillStyle = '#4c4c4c';
        ctx.font = 'bold 12px Arial';
        let y = this.headerHeight - this.state.scrollY;
        data.forEach(group => {
            const groupHeight = (group.tasks.length || 1) * this.cellHeight;
            const textY = y + groupHeight / 2 + 5;
            if (y + groupHeight > this.headerHeight && y < canvas.height) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, Math.max(y, this.headerHeight), this.sidebarWidth, groupHeight);
                ctx.clip();
                ctx.fillText(group.name, 10, textY);
                ctx.restore();
            }
            y += groupHeight;
        });
    }

    drawTasks(ctx, data, dates) {
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
                const width = Math.max(endX - startX, 2);
                const y = this.headerHeight + (taskRow * this.cellHeight) + 5 - this.state.scrollY;

                if (y + this.cellHeight > this.headerHeight && y < ctx.canvas.height) {
                    ctx.fillStyle = this.getTaskColor(task);
                    ctx.beginPath();
                    ctx.roundRect(startX, y, width, this.cellHeight - 10, [5]);
                    ctx.fill();
                    if (task.progress > 0) {
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                        ctx.beginPath();
                        ctx.roundRect(startX, y, width * (task.progress / 100), this.cellHeight - 10, [5]);
                        ctx.fill();
                    }
                    ctx.fillStyle = '#fff';
                    ctx.font = '11px Arial';
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(startX + 5, y, width - 10, this.cellHeight - 10);
                    ctx.clip();
                    ctx.fillText(task.name, startX + 5, y + (this.cellHeight / 2) - 2);
                    ctx.restore();
                }
                task._rect = { x: startX, y, width, height: this.cellHeight - 10 };
                taskRow++;
            });
        });
    }

    getTaskColor(task) {
        const colors = ['#875a7b', '#f06050', '#f4a460', '#6cc1ed', '#d6145f', '#30c381'];
        return colors[task.color % colors.length] || '#875a7b';
    }

    getTaskAt(x, y) {
        for (const group of this.props.data) {
            for (const task of group.tasks) {
                if (task._rect && x >= task._rect.x && x <= task._rect.x + task._rect.width &&
                    y >= task._rect.y && y <= task._rect.y + task._rect.height) {
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

    dispatchEvent(name, detail) {
        this.root.el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }

    onMouseDown(e) {
        const rect = this.canvasRef.el.getBoundingClientRect();
        const task = this.getTaskAt(e.clientX - rect.left, e.clientY - rect.top);
        if (task) {
            this.state.draggedTask = {
                ...task,
                startX: e.clientX,
                originalStart: new Date(task.start_date),
                originalEnd: new Date(task.end_date),
            };
            this.state.tooltip.visible = false;
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
            const taskInUI = this.props.data.flatMap(g => g.tasks).find(t => t.id === this.state.draggedTask.id);
            if (taskInUI) {
                taskInUI.start_date = newStartDate;
                taskInUI.end_date = newEndDate;
                this.drawGantt();
            }
        } else {
            const task = this.getTaskAt(x, y);
            if (task) {
                const startDate = new Date(task.start_date).toLocaleDateString();
                const endDate = new Date(task.end_date).toLocaleDateString();
                this.state.tooltip = {
                    visible: true,
                    content: `${task.name}\nStart: ${startDate}\nEnd: ${endDate}`,
                    x: x + 15,
                    y: y + 15,
                };
            } else {
                this.state.tooltip.visible = false;
            }
        }
    }

    onMouseUp(e) {
        if (this.state.draggedTask) {
            const task = this.props.data.flatMap(g => g.tasks).find(t => t.id === this.state.draggedTask.id);
            if (task) {
                this.dispatchEvent('task-updated', {
                    taskId: task.id,
                    startDate: task.start_date,
                    endDate: task.end_date,
                });
            }
            this.state.draggedTask = null;
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
        this.state.scrollX += e.deltaX;
        this.state.scrollY += e.deltaY;
        this.drawGantt();
    }
}