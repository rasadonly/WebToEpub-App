# Fix the mobile-hook TypeScript error

## What will change

1. Replace the `React.useState` and `React.useEffect` namespace calls in the mobile hook with direct React imports. This removes the code path that can trigger TS2686 when a compiler treats `React` as a browser global.
2. Run the project-wide TypeScript checker after the edit and fix any additional confirmed errors it reports.
3. Check the preview build status before reporting completion.

## Technical note

The checked-in file currently imports React correctly, its reported line 4 is blank, and the current project-wide TypeScript check passes. The direct-import change is compatible with the project's automatic JSX runtime and also protects builds using stricter or stale compiler settings.
