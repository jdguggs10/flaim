# TODO

## Features
- ~~Make the auto-pull league feature also automatically trigger the season pull feature as well.~~ *(Done in v1.1)*

## Bugs

### Active: Auto league discovery refactor

See `docs/AUTO_LEAGUE_DISCOVERY_REFACTOR.md`.

### Resolved

- ~~**League delete succeeds in UI but fails to delete from Supabase**: Fixed in `removeLeague()` - now uses `.select()` to verify rows were deleted and returns `false` if 0 rows matched. Added logging for debugging.~~

- ~~**Silent skip on missing teamId**: Original hypothesis was that leagues were being skipped due to missing teamId. Investigation showed the actual issue is that ESPN returns NO leagues at all, not that leagues are being skipped.~~
