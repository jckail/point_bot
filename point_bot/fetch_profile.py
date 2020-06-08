#!/usr/bin/env python3.8

import shared_functions as sf
from datetime import datetime
import pandas as pd
import os

def generate_rewards_program_dict(
                        point_bot_user,
                        reward_programs=[],
                        rewards_program_name = None,
                        rewards_user_email = None,
                        rewards_username = None,
                        rewards_user_pw = None, 
                        attempts=0, max_attempts=3
                        ):
    attempts+=1 
    bad_evals = [None, ""]
    try:
        if attempts <= max_attempts:
            if rewards_program_name in bad_evals:
                rewards_program_name = sf.recursive_input("What is your Rewards Program?",rewards_program_name)
            if rewards_user_email in bad_evals:
                rewards_user_email = sf.recursive_input(f"What is the Email you use for {rewards_program_name}",rewards_user_email,check_type='email')
            if rewards_user_pw in bad_evals:
                rewards_user_pw = sf.recursive_input(f"Whats the password you use for {rewards_program_name}?",rewards_user_pw)
            
            if (
                            point_bot_user
                            and rewards_program_name
                            and rewards_user_email
                            and rewards_user_pw
                        ):          
                rewards_program_dict =  {
                                            "point_bot_user": str(point_bot_user),
                                            "rewards_program_name": str(rewards_program_name),
                                            "rewards_user_email": str(rewards_user_email),
                                            "rewards_user_pw": str(rewards_user_pw),
                                            "created_time": str(datetime.now()),
                                            "altered_time": str(datetime.now()),
                                            "valid": 0,
                                            "last_successful_login_time": "2020-01-01 01:01:00.000000",
                                            "times_accessed": 0,
                                            "rewards_username": "empty",
                                        }

                if 'y' == sf.recursive_input(
                        f"""Can you Confirm?
                        Rewards Program: {rewards_program_name}
                        Rewards Program Email: {rewards_user_email} 
                        Rewards Program Password: {rewards_user_pw} 
                        """,
                        options=["y", "n"],
                    ):
                    reward_programs.append(rewards_program_dict)
                else:
                    return generate_rewards_program_dict(point_bot_user= point_bot_user, reward_programs= reward_programs)

                if 'y' == sf.recursive_input(
                        "Would you like to add another rewards program?",
                        options=["y", "n"],
                    ):
                    return generate_rewards_program_dict(point_bot_user= point_bot_user, reward_programs= reward_programs)
                else:
                    return reward_programs
            else:
                if rewards_program_name in bad_evals:
                    print("Missing rewards_program")
                if rewards_user_email in bad_evals:
                    print("Missing rewards_user_email")
                if rewards_user_pw in bad_evals:
                    print("Missing rewards_user_pw")
                return generate_rewards_program_dict(
                        point_bot_user,
                        reward_programs=reward_programs,
                        rewards_program_name = rewards_program_name,
                        rewards_user_email = rewards_user_email,
                        rewards_username = rewards_username,
                        rewards_user_pw = rewards_user_pw, 
                        attempts=attempts, max_attempts=max_attempts
                        )
        else:
            raise Exception('Too Many Failed Attempts')
    except Exception as e:
        print(e)

class Point_Bot_User:


    def __init__(self, username=None, users_file="all_users_rewards_programs.json",data_path = '/data/user/' ):
        print('Running From: ' , os.getcwd())
        self.data_path =  os.getcwd()+ data_path
        self.username = username
        if self.username == None:
            # self.username = input("\n What is your point bot username? \n")
            self.username = sf.recursive_input(
                "What is your point bot username?", self.username
            ).lower()
        print(f"\nWelcome {self.username}!")
        self.users_file = self.data_path + users_file
        self.unique_user_file = self.data_path + f'{self.username}_rewards_programs.json'
        self.users_file, self.all_users_data = sf.open_json(self.users_file)
        self.attributes = sf.try_key(self.all_users_data, "point_bot_user", self.username)
        if self.attributes != []:
            print("Found Rewards Profiles!", end="\n")
            print(pd.DataFrame(self.attributes)[['rewards_program_name','rewards_user_email']])
            # would you like to add more to your profile? #present as table
            if "y" == sf.recursive_input(
                "Would you like to add another rewards program?",
                options=["y", "n"],
            ):
                print("adding more data")
                new_data = generate_rewards_program_dict(
                        self.username,
                        )   
            else :
                new_data = [None]
        else:
            print("No Rewards Profiles Found", end="")
            new_data = generate_rewards_program_dict(
                    self.username,
                    )
        sf.save_json(self.users_file,self.all_users_data,newdata=new_data)
        self.unique_user_file, self.attributes = sf.save_json(self.unique_user_file,self.attributes,newdata=new_data) 


def main():
    test_list = generate_rewards_program_dict('jkail')
    print(test_list)


if __name__ == "__main__":
    main()
