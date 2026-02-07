# AI Rules (Read before writing code)

## File separation
- `.tsx` files are for UI components and screens only
- `.ts` files are for logic only
- JSX is never allowed in `.ts` files

## Expo / React
- Functional components only
- Prefer hooks
- Separate UI from logic

## App State
- After every change, update `APP_STATE.md` to keep it in sync with the codebase

## Testing
- When you make a change, run the test suite (`npm test`) and fix any failures before finishing
