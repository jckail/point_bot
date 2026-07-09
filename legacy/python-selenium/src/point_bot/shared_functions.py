#!/usr/bin/env python3.8

import json
import re
from time import sleep
import pandas as pd
from getpass import getpass
from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter

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



def recursive_input(
    input_prompt, eval_value=None, attempts=0, max_attempts=3, options=[],check_type=None,is_pw=False
):
    the_completer = WordCompleter(options)
    
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
        invalid_option_string = f" '{eval_value}' not valid option,"
    else:
        attempt_string = f""
        invalid_option_string = f""
    try:
        if attempts <= max_attempts:
            if eval_value in bad_evals or eval_value not in options:
                if is_pw == True:
                    passgo = False
                    while passgo ==False:
                        eval_value = getpass(f"\n{input_prompt} {options_string}  {attempt_string} \n\n")
                        eval_value2 = getpass(f"\n{input_prompt} {options_string} (again) {attempt_string} \n\n")
                        if eval_value == eval_value2:
                            passgo = True
                        else:
                            print(' \nPasswords do not match please try again!\n')
                else:
                    eval_value = prompt(f" \n {input_prompt} (Press Tab Before enter to auto complete)  \n {invalid_option_string} options: {options} \n{attempt_string}", completer=the_completer)

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

if __name__ == "__main__":
    main()

