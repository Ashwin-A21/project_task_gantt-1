/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Layout } from "@web/search/layout";
import { Component, onWillStart, useState, onWillUpdateProps } from "@odoo/owl";
import { standardViewProps } from "@web/views/standard_view_props";
import { useService } from "@web/core/utils/hooks";
import { GanttRenderer } from "./gantt_renderer";

export class GanttView extends Component {
    static template = "project_task_gantt.GanttView";
    static components = { Layout, GanttRenderer };
    static props = { ...standardViewProps };

    setup() {
        this.actionService = useService("action");
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.state = useState({
            scale: 'month',
            groupBy: this.props.context.group_by || 'project_id',
            ganttData: [],
        });

        onWillStart(async () => await this.loadGanttData());
        onWillUpdateProps(async (nextProps) => {
            if (JSON.stringify(nextProps.domain) !== JSON.stringify(this.props.domain)) {
                await this.loadGanttData(nextProps);
            }
        });
    }

    async loadGanttData(props = this.props) {
        this.state.ganttData = await this.orm.call(
            props.resModel, 'get_gantt_data', [],
            { domain: props.domain, group_by: this.state.groupBy }
        );
    }

    async onTaskUpdated(ev) {
        const { taskId, startDate, endDate } = ev.detail;
        try {
            await this.orm.write(this.props.resModel, [taskId], {
                task_start_date: startDate,
                task_end_date: endDate,
            });
            this.notification.add("Task updated", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to update task", { type: "danger" });
        } finally {
            await this.loadGanttData();
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

    onScaleChange(scale) { this.state.scale = scale; }
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
        });
    }

    async refresh() { await this.loadGanttData(); }
}

registry.category("views").add("gantt", {
    type: "gantt",
    display_name: "Gantt",
    icon: "fa-tasks",
    multiRecord: true,
    searchMenuTypes: ["filter", "groupBy", "favorite"],
    Component: GanttView,
});