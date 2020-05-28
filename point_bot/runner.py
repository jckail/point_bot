import os
import json
from datetime import datetime

# from cryptography.fernet import Fernet


def create_append_json_file(file_name, new_datas=[] ,all_users=0):
    print('in json',new_datas)
    existing_datas = []
    append_flag = 1
    try:
        existing_datas = json.load(open(file_name))
        if all_users == 1:
            for new_data_dict in new_datas:
                for existing_data in existing_datas:
                    if existing_data["point_bot_user"] == new_data_dict["point_bot_user"]:
                        append_flag = 0
                        existing_data["rewards_programs"] = existing_data["rewards_programs"] + new_data_dict["rewards_programs"]

    except Exception as e:
        existing_datas = []
        print(e)
        print("No existing_data ")

    try:
        with open(file_name, "w+") as output_file:
            if append_flag == 1:
                try:
                    print('new',new_datas)
                    print('existing',new_datas)
                    new_datas = new_datas + existing_datas
                except Exception as e:
                    print(e)
            print(f"saving: {file_name}")
            json.dump(new_datas, output_file)
    except:
        print("Unable to save file")


def load_user_data(potential_user_files=[f"{os.getcwd()}/users.json"]):
    for user_file in potential_user_files:
        try:
            print(f""" Looking for {user_file}""")
            user_data = json.load(open(user_file))
            # ensure user, pw, program are valid
            # create logic that choses user_data or merges many records together
            # create logic that ensures strcuture of dict passed out
            return user_data  # returns dict

        except Exception as e:
            print(e)
            print("----NO USER DATA----")
            create_append_user_data()
            # trigger creation
            #
            exit(1)

def rewards_program_dict(
                        point_bot_user = None,
                        reward_programs=[],
                        rewards_program = None,
                        rewards_user_email = None,
                        rewards_user_pw = None,
                        attempts=0,
                        ):
    attempts += 1
    if rewards_program == None:
        rewards_program = input("\nWhat is your Rewards Program? \n")
            # call lookup and fixer function ie regex
    if rewards_user_email == None:
        rewards_user_email = input(
            f"\nWhat is the email you use for {rewards_program}? \n"
        )
        # call lookup and fixer function ie regex
    if rewards_user_pw == None:
        rewards_user_pw = input(
            f"\nWhats the password you use for {rewards_program}? \n"
        )
    if (
                    point_bot_user
                    and rewards_program
                    and rewards_user_email
                    and rewards_user_pw
                ):
        reward_program =  {
                                        "point_bot_user": str(point_bot_user),
                                        "rewards_program_name": str(rewards_program),
                                        "rewards_username": "empty",
                                        "rewards_user_email": str(rewards_user_email),
                                        "rewards_user_pw": str(rewards_user_pw),
                                        "created_time": str(datetime.now()),
                                        "altered_time": str(datetime.now()),
                                        "valid": 0,
                                        "last_successful_login": "Never",
                                        "times_accessed": 0,
                                    }
        reward_programs.append(reward_program)
        print('before json',reward_programs)
        
        add_another_reward = input(
                f"\nWould you like to add another rewards program? y|n \n"
            )
        if add_another_reward == 'y':
            return rewards_program_dict(point_bot_user= point_bot_user, reward_programs= reward_programs)
        else:
            print('out',reward_programs)
            print(type(reward_programs))
            return reward_programs
    else:
        if point_bot_user == None:
            print("Missing point_bot_user")
        if rewards_program == None:
            print("Missing rewards_program")
        if rewards_program == None:
            print("Missing rewards_user_email")
        if rewards_user_pw == None:
            print("Missing rewards_user_pw")
        if attempts <= 3:
            return rewards_program_dict(
                       point_bot_user,
                        reward_programs,
                        rewards_program ,
                        rewards_user_email,
                        rewards_user_pw,
                        attempts
            )
        else:
            raise Exception("Too many Failed attampts Generating Reward Profile Data")


def create_append_user_data(
    point_bot_user=None,
    attempts=0,
    users_file="users.json",
):
    attempts += 1
    try:
        if point_bot_user == None:
            point_bot_user = input("\nWhat is your point bot username? \n")
        if point_bot_user:
            rewards_programs = rewards_program_dict(point_bot_user = point_bot_user)
            print('before go go ', rewards_programs)
            data = [{
                    "point_bot_user": point_bot_user,
                    "rewards_programs": rewards_programs,
                    "created_time": str(datetime.now()),
                }]
            
            create_append_json_file( users_file,data,1)
            create_append_json_file( f"{point_bot_user}_rewards_programs.json",rewards_programs,0)

            return data

        else:
            if point_bot_user == None:
                print("Missing point_bot_user")

            if attempts <= 3:
                return create_append_user_data(
                        point_bot_user,
                            attempts,
                            users_file)
            else:
                raise Exception("Too many Failed attampts Generating Reward Profile Data")

    except Exception as e:
        print(e)
        exit(1)


def main():
    x = create_append_user_data("ellen")
    print(x)


if __name__ == "__main__":
    main()
# 0 execute runner.main
# 1 check if user exists
# if instanciate class
# else save new record in users
