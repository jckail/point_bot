import json 
from getpass import getpass
import re
from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter
import shared_functions as sf
from setup_point_bot import PointBotSetup
import pandas as pd


#to do add encryption to security questions while stored

class UnitedSecurityQuestions:
    def __init__(self,pbs):
        buffer = '-'*15
        self.reset_question_prompt = f'\n {buffer} \n***IMPORTANT*** \n {buffer} \n Go to webpage: https://www.united.com/ual/en/US/account/security/setquestionsanswers \n {buffer} \nReset your questions and follow the prompts \n {buffer} '
        print(self.reset_question_prompt)
        self.pbs = pbs
        self.point_bot_user = pbs.point_bot_user
        self.questionsource = f"resources/reward_program_configs/united_security_questions.json"
        self.current_security_questions_file = f"data/user/{self.point_bot_user}_united_security_questions.json"
        self.unitedlist = eval(pbs.pbloadfile(self.questionsource,readtype='r+'))
        self.all_keys = list(set().union(*(d.keys() for d in self.unitedlist)))
        self.current_security_questions_df = pbs.pbloaddf(self.current_security_questions_file)

    def append_united_security_questions(self):
        
        question = sf.recursive_input(f"What is the Question?")
        answer = sf.recursive_input(f"What was the Answer you selected?")
        #add ability to add in user questions here maybe won't be able to restrict results
        return question, answer

    def generate_user_security_profile(self):
        outputdict = {}
        print(self.reset_question_prompt)
        for iteration in range(1,6):
            question_keys = ['append'] + self.all_keys
            question = sf.recursive_input(f"Question {iteration}/5, if question does not exit type 'append' ",options= question_keys )
            #if question not present then trigger append function
            if question in self.all_keys:
                for uniteddict in self.unitedlist:
                    for keyquestion in uniteddict:
                        if question == keyquestion:
                            answeroptions = uniteddict[question]
                            answer = sf.recursive_input(question,options=answeroptions)
                            #outputlist.append({question:answer})
                            outputdict[question] = answer
            else:
                question, answer = self.append_united_security_questions()
                outputdict[question] = answer

        self.current_security_questions_df = pd.DataFrame([outputdict])

        self.pbs.pbsavedf(self.current_security_questions_file,self.current_security_questions_df,printdf=1)

    def configure_questions(self):
        if not self.current_security_questions_df.empty:
            print(self.current_security_questions_df)
            if 'y'  == sf.recursive_input(f"\n Does this look correct? \n  ",options=["y", "n"],):
                pass
            else:
                self.generate_user_security_profile()
        else:
            self.generate_user_security_profile()

if __name__ == '__main__':
    pbs = PointBotSetup(point_bot_user='jkail', headless = False,offlinemode=0,runspecificbots = ['United']) # ,runspecificbots = ['Southwest']['Marriott','Southwest','United','Test']
    pbs.start()

    usq = UnitedSecurityQuestions(pbs)
    usq.configure_questions()
