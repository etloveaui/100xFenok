from WeeklyDataProcessor import WeeklyDataProcessor

print("Starting weekly update...")
processor = WeeklyDataProcessor()
csv_path = 'C:/Users/etlov/agents-workspace/fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv'
result = processor.process_weekly_data(csv_path)

if result['success']:
    print("Weekly update complete!")
else:
    print(f"Weekly update failed: {result['error']}")
