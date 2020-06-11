import pandas as pd
southwesthtml = '/Users/jordankail/projects/point_bot/src/point_bot/data/botsdata/southwestbot/raw_html/jkail_SouthwestBot_mine_southwest_points_step7_before.html'


df = pd.read_html(southwesthtml)[0]
x = []
print(df.columns)
df.columns = [column.replace('sortable column  ','') for column in df.columns]
print(df.columns)


#print(df)
df.to_json(
    f"/Users/jordankail/projects/point_bot/src/point_bot/data/botsdata/southwestbot/parsed/jkail_southwest_points_parsed.json",
    orient="records",
    indent=4,
)