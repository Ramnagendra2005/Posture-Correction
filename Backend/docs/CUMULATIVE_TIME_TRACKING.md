# Cumulative Time Tracking Feature

This feature enhancement adds cumulative time tracking across all posture analysis sessions, even across day boundaries. This allows users to track their total time investment in maintaining good posture.

## Key Implementation Details

### Backend Changes

1. **DailySummary Model**: 
   - Added `cumulativeDuration` field to store the total time across all sessions
   - Type: Number (seconds)
   - Default: 0

2. **Daily Reset Logic**:
   - When a new day starts, the daily time resets but cumulative time is preserved
   - The system looks up the previous day's cumulative time and carries it over to the new day

3. **Session Tracking**:
   - Each saved session updates both the daily tracked time and the cumulative time
   - The `save-session` endpoint accepts a `updateCumulativeTime` flag and `sessionTimeSeconds` to control this behavior

4. **Migration Tool**:
   - Added `utils/migrateCumulativeTime.js` to populate cumulative time for existing users
   - This script analyzes all existing daily summaries and builds cumulative time values

### Frontend Changes

1. **Analysis.jsx**:
   - Updated session stopping logic to pass `updateCumulativeTime: true` to backend
   - Added display of cumulative time alongside daily time

2. **Report.jsx**:
   - Added display of cumulative time in the analytics dashboard
   - Shows total time investment in hr:min:sec format
   - Added time investment statistics in the weekly overview section

## How Daily Reset Works

1. When a user first opens the app on a new day:
   - System detects there's no DailySummary for the current day
   - Retrieves the most recent DailySummary to get the cumulative time value
   - Creates a new DailySummary with daily metrics reset to zero but preserves the cumulative time

2. As the user completes sessions throughout the day:
   - Daily time tracking starts from zero for the new day
   - Cumulative time continues to increase from the previous total

## Running the Migration

To add cumulative time tracking to existing user data, run:

```
node utils/migrateCumulativeTime.js
```

This will:
1. Process all users in the database
2. Calculate cumulative time across all their daily summaries
3. Update each DailySummary record with the appropriate cumulative time

## Future Enhancements

Potential improvements for this feature include:

1. Achievement system based on cumulative time milestones
2. Visual representation of time investment compared to goal targets
3. Exporting cumulative time statistics for external analysis
