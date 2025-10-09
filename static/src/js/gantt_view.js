/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Layout } from "@web/search/layout";
import { Component, onWillStart, useState, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { GanttRenderer } from "./gantt_renderer";

export class GanttController extends Component {
    static template = "project_task_gantt.GanttController";
    static components = { GanttRenderer };

    setup() {
        this.actionService = useService("action");
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            scale: 'month',
            groupBy: this.props.groupBy || 'project_id',
            ganttData: [],
            isLoading: false,
        });

        onWillStart(async () => await this.loadGanttData());
        onWillUpdateProps(async (nextProps) => {
            if (JSON.stringify(nextProps.domain) !== JSON.stringify(this.props.domain) ||
                nextProps.groupBy !== this.props.groupBy) {
                await this.loadGanttData(nextProps);
            }
        });
    }

    async loadGanttData(props = this.props) {
        this.state.isLoading = true;
        try {
            this.state.ganttData = await this.orm.call(
                props.resModel, 
                'get_gantt_data', 
                [],
                { 
                    domain: props.domain || [], 
                    group_by: this.state.groupBy 
                }
            );
        } catch (error) {
            this.notification.add("Failed to load Gantt data", { type: "danger" });
            console.error("Gantt data load error:", error);
        } finally {
            this.state.isLoading = false;
        }
    }

    async onTaskUpdated(ev) {
        const { taskId, startDate, endDate } = ev.detail;
        try {
            await this.orm.write(this.props.resModel, [taskId], {
                task_start_date: startDate instanceof Date ? startDate.toISOString() : startDate,
                task_end_date: endDate instanceof Date ? endDate.toISOString() : endDate,
            });
            this.notification.add("Task updated successfully", { type: "success" });
            await this.loadGanttData();
        } catch (error) {
            this.notification.add("Failed to update task", { type: "danger" });
            console.error("Task update error:", error);
        }
    }

    onTaskClicked(ev) {
        const { taskId } = ev.detail;
        this.actionService.doAction({
            type: 'ir.actions.act_window',
            res_model: 'project.task',
            res_id: taskId,
            views: [[false, 'form']],
            target: 'new',
            context: { create: false },
        });
    }

    onScaleChange(scale) { 
        this.state.scale = scale; 
    }

    async onGroupByChange(groupBy) {
        this.state.groupBy = groupBy;
        await this.loadGanttData();
    }

    createTask() {
        this.actionService.doAction({
            type: 'ir.actions.act_window',
            res_model: 'project.task',
            views: [[false, 'form']],
            target: 'new',
            context: {
                default_task_start_date: new Date().toISOString(),
            },
        }, {
            onClose: async () => {
                await this.loadGanttData();
            }
        });
    }

    async refresh() { 
        await this.loadGanttData(); 
    }

    exportToCSV() {
        const data = this.state.ganttData;
        if (!data || data.length === 0) {
            this.notification.add("No data to export", { type: "warning" });
            return;
        }

        let csv = "Group,Task Name,Start Date,End Date,Progress,Duration (Days)\n";
        data.forEach(group => {
            group.tasks.forEach(task => {
                const start = new Date(task.start_date).toLocaleDateString();
                const end = new Date(task.end_date).toLocaleDateString();
                const duration = ((new Date(task.end_date) - new Date(task.start_date)) / 86400000).toFixed(1);
                csv += `"${group.name}","${task.name}","${start}","${end}",${task.progress},${duration}\n`;
            });
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gantt_chart_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    zoomIn() {
        this.trigger('zoom-change', { direction: 'in' });
    }

    zoomOut() {
        this.trigger('zoom-change', { direction: 'out' });
    }
}

export class GanttView extends Component {
    static template = "project_task_gantt.GanttView";
    static components = { Layout, GanttController };

    setup() {
        this.state = useState({
            groupBy: this.props.context?.group_by?.[0] || 'project_id',
        });
    }

    getControllerProps() {
        return {
            resModel: this.props.resModel,
            domain: this.props.domain,
            context: this.props.context,
            groupBy: this.state.groupBy,
        };
    }
}

export const ganttView = {
    type: "gantt",
    display_name: "Gantt",
    icon: "fa-tasks",
    multiRecord: true,
    searchMenuTypes: ["filter", "groupBy", "favorite"],
    Controller: GanttController,
    Component: GanttView,
    
    props: (genericProps, view) => {
        const { arch, relatedModels, resModel } = genericProps;
        return {
            ...genericProps,
            Model: undefined,
            Renderer: undefined,
            buttonTemplate: arch.getAttribute("button_template") || undefined,
            archInfo: {
                fieldNames: [],
            },
        };
    },
};

registry.category("views").add("gantt", ganttView);