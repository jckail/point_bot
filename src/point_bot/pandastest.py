import pandas as pd

botname = 'marriottbot'
point_bot_user = 'jkail'

userfile = '/Users/jordankail/projects/point_bot/src/point_bot/data/user/all_users_parsed.json'
#userfile = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
df = pd.read_json(userfile, orient="records")
print(df)

# sum_col = df.groupby(['point_bot_user','rewards_program','start_date']).sum()
# df = df.set_index(['point_bot_user','rewards_program','start_date'])
# df['sum_col'] = sum_col
# df = df.reset_index()


#df2 = g['total_points_running_sum'].sum().reset_index()
#print(df2)
print(df)


def canocolize_program_comparison(point_bot_user,file,points_column,date_column,dateformat):
    pass




if __name__ == '__main__':
    botname = 'marriottbot'
    point_bot_user = 'jkail'
    userfile = f"data/botsdata/{botname}/parsed/{point_bot_user}_{botname.replace('bot','')}_points_parsed.json"
    canocolize_program_comparison('jkail', userfile)