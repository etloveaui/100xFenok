from WeeklyDataProcessor import WeeklyDataProcessor

if __name__ == "__main__":
    processor = WeeklyDataProcessor()
    csv_path = 'C:/Users/etlov/agents-workspace/fenomeno_projects/Global_Scouter/Global_Scouter_20251003/A_Company.csv'
    result = processor.process_weekly_data(csv_path)
    
    if result['success']:
        print("Weekly data processing complete!")
        print(f"Processing result: {result['report']}")
    else:
        print(f"Processing failed: {result['error']}")
