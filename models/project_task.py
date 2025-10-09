from odoo import models, fields, api
from odoo.osv import expression
from odoo.exceptions import ValidationError
import logging

_logger = logging.getLogger(__name__)


class ProjectTask(models.Model):
    _inherit = 'project.task'

    task_start_date = fields.Datetime(
        string='Start Date', 
        tracking=True, 
        copy=False, 
        default=fields.Datetime.now,
        help="Start date for Gantt chart visualization"
    )
    task_end_date = fields.Datetime(
        string='End Date', 
        tracking=True, 
        copy=False,
        help="End date for Gantt chart visualization"
    )
    gantt_duration = fields.Float(
        string='Duration (Days)', 
        compute='_compute_gantt_duration', 
        store=True,
        help="Calculated duration between start and end dates"
    )

    def _parse_datetime_string(self, date_string):
        """
        Parse various datetime string formats to Odoo datetime
        Handles ISO 8601 format with milliseconds and timezone
        """
        if not isinstance(date_string, str):
            return date_string
            
        try:
            # Remove milliseconds: .000Z or .123Z
            date_string = date_string.split('.')[0]
            # Remove timezone indicator
            date_string = date_string.replace('Z', '').replace('z', '')
            # Remove 'T' separator if present
            date_string = date_string.replace('T', ' ')
            
            # Try to parse the datetime
            return fields.Datetime.from_string(date_string)
        except Exception as e:
            _logger.error(f"Failed to parse datetime string '{date_string}': {e}")
            raise ValidationError(f"Invalid datetime format: {date_string}")

    @api.depends('task_start_date', 'task_end_date')
    def _compute_gantt_duration(self):
        """Compute the duration in days between start and end dates"""
        for task in self:
            if task.task_start_date and task.task_end_date:
                delta = task.task_end_date - task.task_start_date
                task.gantt_duration = delta.total_seconds() / 86400.0
            else:
                task.gantt_duration = 0.0

    @api.onchange('task_end_date')
    def _onchange_task_end_date_updates_deadline(self):
        """Synchronize task_end_date with deadline field"""
        if self.task_end_date:
            self.date_deadline = self.task_end_date.date()

    @api.onchange('date_deadline')
    def _onchange_deadline_updates_task_end_date(self):
        """Synchronize deadline with task_end_date field"""
        if self.date_deadline and not self.task_end_date:
            # Set end of day for the deadline
            self.task_end_date = fields.Datetime.to_datetime(self.date_deadline).replace(
                hour=17, minute=0, second=0
            )

    @api.constrains('task_start_date', 'task_end_date')
    def _check_dates(self):
        """Validate that end date is not before start date"""
        for task in self:
            if task.task_start_date and task.task_end_date:
                if task.task_end_date < task.task_start_date:
                    raise ValidationError(
                        'The end date of task "%s" cannot be before its start date.' % task.name
                    )

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to sync deadline with task_end_date"""
        for vals in vals_list:
            try:
                # Handle task_end_date
                if vals.get('task_end_date'):
                    vals['task_end_date'] = self._parse_datetime_string(vals['task_end_date'])
                    if not vals.get('date_deadline'):
                        vals['date_deadline'] = vals['task_end_date'].date()
                
                # Handle task_start_date
                if vals.get('task_start_date'):
                    vals['task_start_date'] = self._parse_datetime_string(vals['task_start_date'])
                
                # Handle date_deadline
                if vals.get('date_deadline') and not vals.get('task_end_date'):
                    if isinstance(vals['date_deadline'], str):
                        vals['date_deadline'] = fields.Date.from_string(vals['date_deadline'])
                    deadline_datetime = fields.Datetime.to_datetime(vals['date_deadline'])
                    vals['task_end_date'] = deadline_datetime.replace(hour=17, minute=0, second=0)
                    
            except Exception as e:
                _logger.error(f"Error processing dates in create: {str(e)}", exc_info=True)
                raise ValidationError(f"Invalid date format: {str(e)}")
                
        return super().create(vals_list)

    def write(self, vals):
        """Override write to sync deadline with task_end_date"""
        try:
            # Handle task_end_date
            if vals.get('task_end_date'):
                vals['task_end_date'] = self._parse_datetime_string(vals['task_end_date'])
                if 'date_deadline' not in vals:
                    vals['date_deadline'] = vals['task_end_date'].date()
            
            # Handle task_start_date
            if vals.get('task_start_date'):
                vals['task_start_date'] = self._parse_datetime_string(vals['task_start_date'])
            
            # Handle date_deadline
            if vals.get('date_deadline') and 'task_end_date' not in vals:
                if isinstance(vals['date_deadline'], str):
                    vals['date_deadline'] = fields.Date.from_string(vals['date_deadline'])
                deadline_datetime = fields.Datetime.to_datetime(vals['date_deadline'])
                vals['task_end_date'] = deadline_datetime.replace(hour=17, minute=0, second=0)
                
        except Exception as e:
            _logger.error(f"Error processing dates in write: {str(e)}", exc_info=True)
            raise ValidationError(f"Invalid date format: {str(e)}")
            
        return super().write(vals)

    @api.model
    def get_gantt_data(self, domain=None, group_by='project_id'):
        """
        Fetch and group tasks for Gantt chart display
        
        Args:
            domain: Search domain to filter tasks
            group_by: Field name to group tasks by
            
        Returns:
            List of dictionaries with grouped task data
        """
        try:
            domain = domain or []
            
            # Only show tasks with both start and end dates
            gantt_domain = expression.AND([
                domain, 
                [('task_start_date', '!=', False), ('task_end_date', '!=', False)]
            ])

            # Validate group_by field
            valid_group_fields = ['project_id', 'user_ids', 'stage_id', 'priority', 'partner_id']
            if group_by not in valid_group_fields:
                _logger.warning(f"Invalid group_by field '{group_by}', defaulting to 'project_id'")
                group_by = 'project_id'

            # Ensure field exists and is stored
            if group_by not in self.env['project.task']._fields:
                group_by = 'project_id'
            elif not self.env['project.task']._fields[group_by].store:
                group_by = 'project_id'

            # Fields to read from tasks
            fields_to_read = [
                'name', 
                'task_start_date', 
                'task_end_date', 
                'color',
                'priority',
                'description',
                group_by
            ]
            
            # Add progress field if it exists (might not exist in all Odoo versions)
            if 'progress' in self.env['project.task']._fields:
                fields_to_read.append('progress')

            tasks_data = self.search_read(gantt_domain, fields_to_read, order='task_start_date asc')
            
            if not tasks_data:
                _logger.info("No tasks found matching criteria")
                return []

            # Group tasks by the specified field
            grouped_data = {}
            
            for task in tasks_data:
                group_field_value = task.get(group_by)
                
                # Handle different field types
                if isinstance(group_field_value, (list, tuple)) and len(group_field_value) > 0:
                    # Many2one or Many2many field
                    if isinstance(group_field_value[0], (list, tuple)):
                        # Many2many - take first relation
                        group_key = group_field_value[0][0] if group_field_value[0] else 'unassigned'
                        group_name = group_field_value[0][1] if group_field_value[0] else 'Unassigned'
                    else:
                        # Many2one
                        group_key = group_field_value[0]
                        group_name = group_field_value[1]
                elif isinstance(group_field_value, bool) and not group_field_value:
                    group_key = 'unassigned'
                    group_name = 'Unassigned'
                elif group_field_value is False:
                    group_key = 'unassigned'
                    group_name = 'Unassigned'
                else:
                    # Selection or other field types
                    group_key = str(group_field_value)
                    group_name = str(group_field_value).replace('_', ' ').title()

                # Initialize group if not exists
                if group_key not in grouped_data:
                    grouped_data[group_key] = {
                        'id': group_key, 
                        'name': group_name, 
                        'tasks': []
                    }

                # Add task to group
                task_dict = {
                    'id': task['id'],
                    'name': task['name'],
                    'start_date': task['task_start_date'].isoformat() if task['task_start_date'] else None,
                    'end_date': task['task_end_date'].isoformat() if task['task_end_date'] else None,
                    'progress': task.get('progress', 0) or 0,
                    'color': task.get('color', 0) or 0,
                    'priority': task.get('priority', '0'),
                    'description': task.get('description', '') or '',
                }
                
                grouped_data[group_key]['tasks'].append(task_dict)

            # Sort groups by name and return as list
            result = sorted(grouped_data.values(), key=lambda x: x['name'])
            
            _logger.info(f"Gantt data loaded: {len(result)} groups, {sum(len(g['tasks']) for g in result)} tasks")
            
            return result
            
        except Exception as e:
            _logger.error(f"Error in get_gantt_data: {str(e)}", exc_info=True)
            # Return empty list instead of raising to prevent frontend crash
            return []

    def action_open_gantt_view(self):
        """Action to open Gantt view for current task's project"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Project Gantt Chart',
            'res_model': 'project.task',
            'view_mode': 'gantt,tree,form',
            'domain': [('project_id', '=', self.project_id.id)],
            'context': {'group_by': 'stage_id'},
        }