#!/usr/bin/env python3.8

import shared_functions as sf
from pointbotencryption import PointBotEncryption
from datetime import datetime
import pandas as pd
import os




class Point_Bot_User:


    def __init__(self, pbs, point_bot_user=None):
        self.pbs = pbs
        self.config_df = pd.read_json(pbs.configpath, orient="records")
        self.configured_reward_programs = self.config_df['rewards_program_name'].tolist()
        self.point_bot_user = point_bot_user
        if self.point_bot_user == None:
            self.point_bot_user = sf.recursive_input(
                "What is your point bot username?", self.point_bot_user
            ).lower()
        pbs.point_bot_user = self.point_bot_user
        self.pbe = PointBotEncryption(pbs)
        self.unique_user_file = pbs.uniqueuserdatapath + f'{self.point_bot_user}_rewards_programs.json'
        self.all_users_data = sf.open_json(pbs.userdatapath)
        print(f"\nWelcome {self.point_bot_user}!")
        self.load_user()


    def generate_rewards_program_dict(self,
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
                    rewards_program_name = sf.recursive_input("What is your Rewards Program?",rewards_program_name,options=self.configured_reward_programs)
                if rewards_user_email in bad_evals:
                    rewards_user_email = sf.recursive_input(f"What is the Email you use for {rewards_program_name}",rewards_user_email,check_type='email')
                if rewards_username in bad_evals:
                    rewards_username = sf.recursive_input(f"Whats your User name for {rewards_program_name}? (Programs like Southwest use this instead of your email)",rewards_username)
                if rewards_user_pw in bad_evals:
                    rewards_user_pw = sf.recursive_input(f"Whats the password you use for {rewards_program_name}? humans will not see this as it will be encrypted",rewards_user_pw,is_pw=True)
                
                if (
                                self.point_bot_user
                                and rewards_program_name
                                and rewards_user_email
                                and rewards_user_pw
                            ):          
                    rewards_program_dict =  {
                                                "point_bot_user": str(self.point_bot_user),
                                                "rewards_program_name": str(rewards_program_name),
                                                "rewards_user_email": str(rewards_user_email),
                                                "rewards_username": str(rewards_username),
                                                "rewards_user_pw": self.pbe.encrypt_string(str(rewards_user_pw)).decode(),
                                                "created_time": str(datetime.now()),
                                                "altered_time": str(datetime.now()),
                                                "valid": 0,
                                                "last_successful_login_time": "2020-01-01 01:01:00.000000",
                                                "times_accessed": 0,
                                                "decryptionkey":str(self.point_bot_user)+str(self.pbs.timestr)
                                                
                                            }

                    if 'y' == sf.recursive_input(
                            f"""
                            ---------------------------------------------
                            Can you Confirm?
                            Rewards Program: {rewards_program_name}
                            Rewards Program Email: {rewards_user_email} 
                            Rewards Program Password: {rewards_user_pw} * This will be encrypted no human besides you right now will see this*
                            ---------------------------------------------
                            """,
                            options=["y", "n"],
                        ):
                        reward_programs.append(rewards_program_dict)
                    else:
                        return self.generate_rewards_program_dict(reward_programs= reward_programs)

                    if 'y' == sf.recursive_input(
                            "Would you like to add another rewards program?",
                            options=["y", "n"],
                        ):
                        return self.generate_rewards_program_dict(reward_programs= reward_programs)
                    else:
                        return reward_programs
                else:
                    if rewards_program_name in bad_evals:
                        print("Missing rewards_program")
                    if rewards_user_email in bad_evals:
                        print("Missing rewards_user_email")
                    if rewards_user_pw in bad_evals:
                        print("Missing rewards_user_pw")
                    return self.generate_rewards_program_dict(
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

    def load_user(self):       
        self.attributes = sf.try_key(self.all_users_data, "point_bot_user", self.point_bot_user)
        if self.attributes != []:
            print("Found Rewards Profiles!", end="\n")
            print(pd.DataFrame(self.attributes)[['rewards_program_name','rewards_user_email','rewards_program_name']])
            if "y" == sf.recursive_input(
                "Would you like to add another rewards program?",
                options=["y", "n"],
            ):
                print("adding more data")
                new_data = self.generate_rewards_program_dict()   
            else :
                new_data = [None]
        else:
            print("No Rewards Profiles Found", end="")
            new_data = self.generate_rewards_program_dict()
        sf.save_json(self.pbs.userdatapath,self.all_users_data,newdata=new_data)
        sf.save_json(self.unique_user_file,self.attributes,newdata=new_data)


if __name__ == "__main__":
    main()
