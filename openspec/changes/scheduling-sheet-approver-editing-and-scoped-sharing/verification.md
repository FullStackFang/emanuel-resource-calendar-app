## Verification log

### Baseline and reproduction - 2026-09-09

The local integration and component seams reproduce the reported behavior without contacting production services:

- A non-Events approver receives 403 from the shared Scheduling Sheets gate (`SS-2`), while an Events-department requester receives 200 (`SS-1`). The frontend approver simulation likewise sets `canManageAssignments` to false unless the actual user has the Events department grant.
- The grid renders an add-row text input with an Enter handler but no Add Row button.
- The Enter handler calls the existing structural mutation, then clears the input synchronously. The input is therefore lost before validation, network, or version-conflict failure is known. No separate mutation defect was observed in the passing structural route tests.

Focused baseline commands:

```text
npm.cmd run test:run -- src/__tests__/unit/components/scheduling/SchedulingSheetGrid.inlineEditing.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.calendarWarning.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.components.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.firstPaint.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.newSheetPanel.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.pdfExport.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.route.test.jsx src/__tests__/unit/components/scheduling/SchedulingSheets.workbookPicker.test.jsx src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx src/__tests__/unit/hooks/usePermissions.contract.test.jsx src/__tests__/unit/hooks/useSchedulingSheets.optimisticCell.test.jsx
```

Result: 11 files passed, 148 tests passed. Pre-existing React `act(...)` warnings appeared in four `EmailSchedulesPanel` tests; there were no failures.

```text
cd backend
npm.cmd test -- __tests__/unit/utils/permissionUtils.test.js __tests__/unit/utils/assignmentSchedule.test.js __tests__/integration/schedulingSheets.test.js __tests__/integration/schedulingSheetEmail.test.js --runInBand
```

Result: 4 suites passed, 135 tests passed. Expected application logger output was present; there were no failures.
