#!/usr/bin/env python3.8

import json
import re
from time import sleep
import pandas as pd
from getpass import getpass
# Make a regular expression 
# for validating an Email 

# for custom mails use: '^[a-z0-9]+[\._]?[a-z0-9]+[@]\w+[.]\w+$' 
      
# Define a function for 
# for validating an Email 
def checker(check_string,check_type): 
    valid_type = 0
    try:
        if check_type == None:
            return True
        elif check_type == 'email':
            regex = '^[a-z0-9]+[\._]?[a-z0-9]+[@]\w+[.]\w{2,3}$'
            format_requirment = 'johndoe@gmail.com'
            valid_type = 1
        else:
            raise Exception('Invalid Check Type CUSTOM JORDAN FUNCTION: shared_functions.check')
        # pass the regular expression 
        # and the string in search() method 
        if valid_type == 1:
            if(re.search(regex,check_string)):  
                #print(f"{check_string} is Valid {check_type}")  
                return True
            else:  
                print(f"{check_string} is Invalid {check_type} ie {format_requirment}") 
                return False
        else:
            raise Exception('Invalid Check Type CUSTOM JORDAN FUNCTION: shared_functions.check')
    except Exception as e:
        print(e)



def open_json(filename,attempts = 0, max_attempts = 3):
    attempts += 1

    if attempts <= max_attempts:
        try:
            print(f"""Loading {filename}""")
            json_data = json.load(open(filename))
            return json_data

        except Exception as e:
            print(e)
            #print(f"----{filename} not Found---- Retrying Attempt:{attempts}/{max_attempts}")
            return open_json(filename,attempts)
    else:
        print(f"""

            {filename} NOT FOUND CREATING NEW FILE
        
        """)
        json_data = []
        save_json(filename,json_data)
        return json_data
        

def save_json(output_filename,data,newdata=[None]):
    try:
        if newdata != [None]:
            data = data + newdata
        with open(output_filename, "w") as output_file:
            json.dump(data, output_file, indent=4)
        print(f'\n Saving: {output_filename} \n')
        return data
    except Exception as e:
        print(e)


def try_key(dictonary_objects, dict_key, compare_key):
    return_dictionary_objects = []
    try:
        for dictonary_object in dictonary_objects:
            if compare_key == dictonary_object[dict_key]:
                return_dictionary_objects.append(dictonary_object)
        return return_dictionary_objects

    except Exception as e:
        print(e)
        print("----NO USER DATA----")


def recursive_input(
    input_prompt, eval_value=None, attempts=0, max_attempts=3, options=[],check_type=None,is_pw=False
):
    attempts += 1
    bad_evals = [None, ""]
    if options != []:
        if len(options) < 3:
            splitter = ' or '
        else:
            splitter = ', '
        
        options_string = f"\n           Options: {splitter.join(options)}"
    else:
        options_string = ""
    if attempts > 1:
        attempt_string = f"Attempt:{attempts}/{max_attempts}"
    else:
        attempt_string = f""
    try:
        if attempts <= max_attempts:
            if eval_value in bad_evals or eval_value not in options:
                if is_pw == True:
                    eval_value = getpass(f"\n{input_prompt} {options_string}  {attempt_string} \n\n")
                else:
                    eval_value = input(
                        f"\n{input_prompt} {options_string}  {attempt_string} \n\n"
                    )
                if eval_value not in bad_evals and checker(eval_value,check_type):
                    if options != []:
                        if eval_value in options:
                            return eval_value
                        else:
                            print(f"\n {eval_value} is an Invalid Input: {options_string}")
                            return recursive_input(
                                input_prompt,
                                eval_value=eval_value,
                                attempts=attempts,
                                max_attempts=max_attempts,
                                options=options,
                            )
                    elif options == []:
                        return eval_value

                else:
                    print('Invalid input please try again')
                    return recursive_input(
                        input_prompt,
                        eval_value=eval_value,
                        attempts=attempts,
                        max_attempts=max_attempts,
                        options=options,
                    )
            else:
                return eval_value
        else:
            raise Exception(f"TOO MANY FAILED ATTEMPTS: {input_prompt}")
    except Exception as e:
        print(e)


# def main():
#     # more_data_flag = recursive_input(
#     #     "Would you like to add more data? (y|n) ",
#     #     eval_value=None,
#     #     attempts=0,
#     #     max_attempts=3,
#     #     options=["y", "n"],
#     # )
#     # print(more_data_flag)
#     #checker('jkail@gmail','email')
#     json_data = open_json('users.json')
#     save_json(filename,json_data)

if __name__ == "__main__":
    main()

