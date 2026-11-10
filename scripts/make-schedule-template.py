#!/usr/bin/env python3
"""Build the Schedulers' Excel template for Schedule > Import.

    python3 scripts/make-schedule-template.py ROSTER.csv OUT.xlsx [--until 2026-12-31]

ROSTER.csv is the Active Roster 2 export (Name, Email, Lab, ...). The roster stays out
of the repo: names and emails only go into the .xlsx you make. The columns here are
exactly what src/lib/importer.js reads (planScheduleImport), and the labs, shifts and
robots match public/config.js. Change them together.
"""
import csv
import sys
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# Keep in step with public/config.js.
LABS = [
    ('Redmond Lab', ['Robot 1', 'Robot 2'], [('Morning', '7:00 AM', '12:30 PM', 2), ('Afternoon', '12:00 PM', '5:30 PM', 2), ('Night', '5:00 PM', '11:00 PM', 4)], 'Every day'),
    ('Mountain View Lab', ['Robot 3', 'Robot 4'], [('Morning', '7:00 AM', '12:30 PM', 2), ('Afternoon', '12:00 PM', '5:30 PM', 2)], 'Monday to Friday'),
]
ROBOT_NAMES = {'Robot 1': 'Stationary', 'Robot 2': 'Mobile', 'Robot 3': 'franka-thor-02', 'Robot 4': 'jetson-thor-004'}
SHIFTS = ['Morning', 'Afternoon', 'Night', 'Custom']
ROBOTS = ['Any'] + [r for _, robots, _, _ in LABS for r in robots]
PAIRS = ['A', 'B', 'C', 'D']
COLUMNS = [  # header, width, note
    ('Date', 13, 'The day of the shift. Type it like 11/17/2026.'),
    ('Lab', 20, 'Redmond Lab or Mountain View Lab. Operators only work at their home lab.'),
    ('Shift', 12, 'Morning, Afternoon or Night (Redmond only). Pick Custom and fill in Start and End for other times.'),
    ('Operator', 28, 'Pick from the list. One row per operator per shift.'),
    ('Email', 34, 'Fills in by itself from the Operator. Leave it.'),
    ('Pair', 8, 'Same letter = same pair. Two operators per pair, at least one experienced. Leave blank to pair by robot.'),
    ('Robot', 11, 'Optional. Blank or Any = any robot.'),
    ('Start', 10, 'Only for Custom shifts, like 9:00 AM.'),
    ('End', 10, 'Only for Custom shifts, like 3:00 PM.'),
    ('Note', 30, 'Optional, shows on the shift.'),
]
ROWS = 1500  # formatted, validated rows on the Schedule sheet

INK, MUTED, LINE, HEAD = '1F2430', '6B7280', 'D9DDE3', 'EEF1F5'
head_font = Font(bold=True, color=INK)
head_fill = PatternFill('solid', fgColor=HEAD)
thin = Side(style='thin', color=LINE)
grid = Border(left=thin, right=thin, top=thin, bottom=thin)


def roster(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        name, email = (r.get('Name') or '').strip(), (r.get('Email') or '').strip().lower()
        if name and email:
            out.append({'name': name, 'email': email, 'lab': (r.get('Lab') or '').strip(), 'cohort': (r.get('Cohort') or '').strip(), 'training': (r.get('Training Status') or '').strip()})
    return sorted(out, key=lambda o: o['name'].lower())


def header(ws, cols, row=1):
    for i, (h, w, note) in enumerate(cols, start=1):
        c = ws.cell(row=row, column=i, value=h)
        c.font, c.fill, c.border = head_font, head_fill, grid
        c.alignment = Alignment(vertical='center')
        if note:
            c.comment = Comment(note, 'Lotus')
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 22
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def build(ops, until, out):
    today = date.today()
    wb = Workbook()

    # Lists: the dropdowns' sources, and a reference for Schedulers.
    lists = wb.active
    lists.title = 'Lists'
    header(lists, [('Operator', 28, None), ('Email', 34, None), ('Home lab', 20, None), ('Cohort', 10, None), ('Training', 18, None), ('', 3, None), ('Lab', 20, None), ('Shift', 12, None), ('Start', 10, None), ('End', 10, None), ('Operators', 10, None), ('Runs', 18, None), ('', 3, None), ('Robot', 10, None), ('Robot name', 18, None), ('Lab', 20, None)])
    for i, o in enumerate(ops, start=2):
        for j, k in enumerate(['name', 'email', 'lab', 'cohort', 'training'], start=1):
            lists.cell(row=i, column=j, value=o[k])
    r = 2
    for lab, _, shifts, runs in LABS:
        for s, a, b, seats in shifts:
            for j, v in enumerate([lab, s, a, b, seats, runs], start=7):
                lists.cell(row=r, column=j, value=v)
            r += 1
    r = 2
    for lab, robots, _, _ in LABS:
        for rb in robots:
            for j, v in enumerate([rb, ROBOT_NAMES.get(rb, ''), lab], start=14):
                lists.cell(row=r, column=j, value=v)
            r += 1
    last = max(2, len(ops) + 1)

    # Schedule: what gets imported.
    ws = wb.create_sheet('Schedule', 0)
    header(ws, COLUMNS)
    end = ROWS + 1
    for row in range(2, end + 1):
        ws.cell(row=row, column=1).number_format = 'm/d/yyyy'
        ws.cell(row=row, column=5, value=f'=IF(D{row}="","",IFERROR(VLOOKUP(D{row},Lists!$A$2:$B${last},2,FALSE),""))')
        ws.cell(row=row, column=5).font = Font(color=MUTED)
        for col in (8, 9):
            ws.cell(row=row, column=col).number_format = '@'
    validations = [
        DataValidation(type='date', operator='between', formula1=f'DATE({today.year},{today.month},{today.day})', formula2=f'DATE({until.year},{until.month},{until.day})', showErrorMessage=True, errorTitle='Date', error=f'Pick a date from {today:%m/%d/%Y} to {until:%m/%d/%Y}.', sqref=f'A2:A{end}'),
        DataValidation(type='list', formula1='"' + ','.join(l[0] for l in LABS) + '"', showErrorMessage=True, errorTitle='Lab', error='Pick a lab from the list.', sqref=f'B2:B{end}'),
        DataValidation(type='list', formula1='"' + ','.join(SHIFTS) + '"', showErrorMessage=True, errorTitle='Shift', error='Pick Morning, Afternoon, Night or Custom.', sqref=f'C2:C{end}'),
        DataValidation(type='list', formula1=f'Lists!$A$2:$A${last}', showErrorMessage=True, errorTitle='Operator', error='Pick an operator from the list. Ask the Lotus admin to add anyone missing to the Roster first.', sqref=f'D2:D{end}'),
        DataValidation(type='list', formula1='"' + ','.join(PAIRS) + '"', showErrorMessage=False, sqref=f'F2:F{end}'),
        DataValidation(type='list', formula1='"' + ','.join(ROBOTS) + '"', showErrorMessage=True, errorTitle='Robot', error='Pick a robot, or Any.', sqref=f'G2:G{end}'),
    ]
    for dv in validations:
        ws.add_data_validation(dv)
    # Gentle flags while filling in: Night at Mountain View, and Custom without times.
    warn = PatternFill('solid', fgColor='FDE8E8')
    ws.conditional_formatting.add(f'C2:C{end}', FormulaRule(formula=['AND($B2="Mountain View Lab",$C2="Night")'], fill=warn))
    ws.conditional_formatting.add(f'H2:I{end}', FormulaRule(formula=['AND($C2="Custom",H2="")'], fill=warn))
    ws.auto_filter.ref = f'A1:J{end}'

    # Example: a filled-in week to copy from. It never imports.
    ex = wb.create_sheet('Example', 1)
    header(ex, COLUMNS)
    names = [o['name'] for o in ops] or ['Operator One', 'Operator Two', 'Operator Three', 'Operator Four']
    names = (names * 8)[:8]
    first = today + timedelta(days=(7 - today.weekday()) % 7 or 7)  # next Monday
    sample = [
        (first, 'Redmond Lab', 'Morning', names[0], 'A', 'Any', '', '', ''),
        (first, 'Redmond Lab', 'Morning', names[1], 'A', 'Any', '', '', ''),
        (first, 'Redmond Lab', 'Afternoon', names[2], 'A', 'Robot 1', '', '', ''),
        (first, 'Redmond Lab', 'Afternoon', names[3], 'A', 'Robot 1', '', '', ''),
        (first, 'Redmond Lab', 'Night', names[4], 'A', 'Robot 1', '', '', ''),
        (first, 'Redmond Lab', 'Night', names[5], 'A', 'Robot 1', '', '', ''),
        (first, 'Redmond Lab', 'Night', names[6], 'B', 'Robot 2', '', '', ''),
        (first, 'Redmond Lab', 'Night', names[7], 'B', 'Robot 2', '', '', ''),
        (first + timedelta(days=1), 'Redmond Lab', 'Custom', names[0], 'A', 'Any', '9:00 AM', '3:00 PM', 'Training day'),
        (first + timedelta(days=1), 'Redmond Lab', 'Custom', names[2], 'A', 'Any', '9:00 AM', '3:00 PM', 'Training day'),
    ]
    by_name = {o['name']: o['email'] for o in ops}
    for i, (d, lab, s, who, pair, rb, a, b, note) in enumerate(sample, start=2):
        for j, v in enumerate([d, lab, s, who, by_name.get(who, ''), pair, rb, a, b, note], start=1):
            c = ex.cell(row=i, column=j, value=v)
            if j == 1:
                c.number_format = 'm/d/yyyy'

    # Instructions.
    ins = wb.create_sheet('Instructions', 0)
    ins.column_dimensions['A'].width = 110
    lines = [
        ('Lotus schedule template', 'title'),
        (f'Fill in the Schedule sheet with every shift from now to {until:%B %-d, %Y}. The Lotus admin imports it in the app (Schedule > Import), checks the preview, then saves.', None),
        ('', None),
        ('How to fill it in', 'h'),
        ('1. One row per operator per shift. A pair is two rows: same date, lab, shift and Pair letter.', None),
        ('2. Date: type it like 11/17/2026.', None),
        ('3. Lab: Redmond Lab or Mountain View Lab. Operators only work at their home lab (see Lists).', None),
        ('4. Shift: Morning 7:00 AM–12:30 PM, Afternoon 12:00 PM–5:30 PM, Night 5:00 PM–11:00 PM (Redmond only).', None),
        ('   For any other time, pick Custom and fill in Start and End (like 9:00 AM).', None),
        ('5. Operator: pick from the list. Email fills in by itself; leave it.', None),
        ('6. Pair: A for the first pair in that shift, B for the second (Redmond Night needs two pairs). Every pair needs at least one experienced operator.', None),
        ('7. Robot: optional. Leave blank (or Any) unless the pair must be on a particular robot.', None),
        ('8. Note: optional, it shows on the shift.', None),
        ('', None),
        ('How many people each shift needs', 'h'),
        ('Redmond Lab, every day: Morning 2 (one pair), Afternoon 2 (one pair), Night 4 (a pair on each robot).', None),
        ('Mountain View Lab, Monday to Friday: Morning 2, Afternoon 2.', None),
        ('', None),
        ('Good to know', 'h'),
        ('Keep the column headers and the sheet names as they are. Only the Schedule sheet is imported; Example and Lists are for reference.', None),
        ('Leave rows blank rather than deleting columns. Blank rows are ignored.', None),
        ('Anyone missing from the Operator list has to be added to the Lotus Roster first; ask the Lotus admin.', None),
        ('The weekly limit is 37 hours per operator. The app warns about it, about two new operators paired together and about double bookings.', None),
        ('Sending the same file again later is fine: shifts already in Lotus are updated, not doubled.', None),
        ('This is the plan only. Hours worked come from clock-ins in the app, never from this sheet.', None),
    ]
    for i, (t, kind) in enumerate(lines, start=1):
        c = ins.cell(row=i, column=1, value=t)
        c.alignment = Alignment(wrap_text=True, vertical='top')
        if kind == 'title':
            c.font = Font(bold=True, size=16, color=INK)
        elif kind == 'h':
            c.font = Font(bold=True, size=12, color=INK)
    wb.active = 1  # open on the Schedule sheet
    for s in wb.worksheets:
        s.sheet_view.tabSelected = s.title == 'Schedule'
    wb.save(out)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    until = date(2026, 12, 31)
    if '--until' in sys.argv:
        until = date.fromisoformat(sys.argv[sys.argv.index('--until') + 1])
        args = [a for a in args if a != str(until)]
    if len(args) != 2:
        sys.exit(__doc__)
    build(roster(args[0]), until, args[1])
