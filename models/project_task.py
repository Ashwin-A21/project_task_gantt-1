from odoo import models, fields, api
from odoo.osv import expression
from odoo.exceptions import ValidationError

class ProjectTask(models.Model):
    _inherit = 'project.task'

    task_start_date = fields.Datetime(string='Start Date', tracking=True, copy=False, default=fields.Datetime.now)
    task_end_date = fields.Datetime(string='End Date', tracking=True, copy=False)
    gantt_duration = fields.Float(string='Duration (Days)', compute='_compute_gantt_duration', store=True)

    @api.depends('task_start_date', 'task_end_date')
    def _compute_gantt_duration(self):
        for task in self:
            if task.task_start_date and task.task_end_date:
                delta = task.task_end_date - task.task_start_date
                task.gantt_duration = delta.total_seconds() / 86400.0
            else:
                task.gantt_duration = 0.0

    @api.onchange('task_end_date')
    def _onchange_task_end_date_updates_deadline(self):
        if self.task_end_date:
            self.date_deadline = self.task_end_date.date()

    @api.constrains('task_start_date', 'task_end_date')
    def _check_dates(self):
        for task in self:
            if task.task_start_date and task.task_end_date and task.task_end_date < task.task_start_date:
                raise ValidationError('The end date of a task cannot be before its start date.')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('task_end_date'):
                vals['date_deadline'] = fields.Datetime.to_datetime(vals['task_end_date']).date()
        return super().create(vals_list)

    def write(self, vals):
        if vals.get('task_end_date'):
            vals['date_deadline'] = fields.Datetime.to_datetime(vals['task_end_date']).date()
        return super().write(vals)

    @api.model
    def get_gantt_data(self, domain=None, group_by='project_id'):
        domain = domain or []
        gantt_domain = expression.AND([domain, [('task_start_date', '!=', False), ('task_end_date', '!=', False)]])

        if group_by not in self.env['project.task']._fields or not self.env['project.task']._fields[group_by].store:
            group_by = 'project_id'

        fields_to_read = ['name', 'task_start_date', 'task_end_date', 'progress', 'color', group_by]
        tasks_data = self.search_read(gantt_domain, fields_to_read)

        grouped_data = {}
        for task in tasks_data:
            group_field_value = task.get(group_by)
            group_key = group_field_value[0] if isinstance(group_field_value, tuple) else 'unassigned'
            group_name = group_field_value[1] if isinstance(group_field_value, tuple) else 'Unassigned'

            if group_key not in grouped_data:
                grouped_data[group_key] = {'id': group_key, 'name': group_name, 'tasks': []}

            grouped_data[group_key]['tasks'].append({
                'id': task['id'],
                'name': task['name'],
                'start_date': task['task_start_date'].isoformat(),
                'end_date': task['task_end_date'].isoformat(),
                'progress': task.get('progress', 0) or 0,
                'color': task.get('color', 0) or 0,
            })

        return list(grouped_data.values())