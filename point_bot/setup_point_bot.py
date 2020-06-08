import os
import sys
import getpass
import time
import socket
import glob


class PointBotSetup:
    def __init__(
        self,
        pbs_cwd=os.getcwd(),
        subdirs=["data", "resources", "bots"],
        datasubdirs=["user", "reward_program_configs", "botsdata"],
        resourcessubdirs=["reward_program_configs"],
        botsubdirs=[
            "console_logger",
            "dataLayer",
            "parsed",
            "raw_html",
            "screencaps",
            "tracking_data",
        ],
        dir_config = [            
            {"data": ["user", "reward_program_configs", "botsdata"]},
            {"bots": []},
            {"resources": ["reward_program_configs","encryptionkeys"]}],
        sys_username=getpass.getuser(),
        sys_hostname=socket.gethostname(),
        userdatapath="data/user/all_users_rewards_programs.json",
        configpath="data/reward_program_configs/all_config_reward_programs.json",
        timestr=time.strftime("%Y%m%d%H%M%S"),
        sysplatform=sys.platform,
        ssysname=os.uname().sysname,
        version=os.uname().version,
        release=os.uname().release,
        machine=os.uname().machine,
        nodename=os.uname().nodename,
    ):
        self.pbs_cwd = pbs_cwd

        self.subdirs = subdirs
        self.datasubdirs = datasubdirs
        self.botsubdirs = botsubdirs
        self.sys_username = sys_username
        self.sys_hostname = sys_hostname
        self.userdatapath = userdatapath
        self.configpath = configpath
        self.timestr = timestr
        self.sysplatform = sysplatform
        self.ssysname = ssysname
        self.version = version
        self.release = release
        self.machine = machine
        self.nodename = nodename
        self.dir_config = dir_config

        #this is where you would create a unique runstring that for x type of machine indicates this string
        self.system_info_dict = {
            'timestr': self.timestr,
            'sys_username': self.sys_username,
            'sys_hostname': self.sys_hostname,
            'sysplatform': self.sysplatform,
            'ssysname': self.ssysname,
            'version': self.version,
            'release': self.release,
            'machine': self.machine,
            'nodename': self.nodename,
        }

    def create_dir(self, directory):
        directory = f"{self.pbs_cwd}/{directory}"
        if not os.path.exists(directory):
            os.makedirs(directory)
        return directory

    def create_sub_dirs(self, parent_dir, subdirs):
        return [self.create_dir(f"{parent_dir}/{subdir}") for subdir in subdirs]

    def identify_files(self,subdir = "bots",extension='_bot.py',replacer='bot'):
        return [filex.replace(extension,replacer)for filex in os.listdir(self.create_dir( subdir))if filex.endswith(extension)]

    def gen_bit_config(self):
        return [self.dir_config.append({f'data/botsdata/{x}':self.botsubdirs}) for x in self.identify_files(subdir = "bots",extension='_bot.py',replacer='bot')]
    
    def generate_directories(self):
        self.gen_bit_config()
        [[self.create_sub_dirs(y, x[y]) for y in x.keys()] for x in self.dir_config]

    def start(self):
        self.generate_directories()

if __name__ == "__main__":
    pbs = PointBotSetup()
    pbs.start()
    # pbs.generate_directories()
    # path = os.getcwd()
    # print(path)
    # x = 'abc'
    # print(cardnality(x))

    #print(PointBotSetup().system_info_dict)



