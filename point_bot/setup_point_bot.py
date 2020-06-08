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
            {"resources": ["reward_program_configs"]}],
        username=getpass.getuser(),
        hostname=socket.gethostname(),
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
        self.username = username
        self.hostname = hostname
        self.userdatapath = userdatapath
        self.configpath = configpath
        self.timestr = timestr
        self.sysplatform = sysplatform
        self.ssysname = sysplatform
        self.version = sysplatform
        self.release = sysplatform
        self.machine = sysplatform
        self.nodename = sysplatform
        self.dir_config = dir_config

    def create_dir(self, directory):
        directory = f"{self.pbs_cwd}/{directory}"
        if not os.path.exists(directory):
            os.makedirs(directory)
        return directory

    def create_sub_dirs(self, parent_dir, subdirs):
        return [self.create_dir(f"{parent_dir}/{subdir}") for subdir in subdirs]

    def identify_files(self,subdir = "bots",extension='_bot.py',replacer='bot'):
        return [print(filex.replace(extension,replacer))for filex in os.listdir(self.create_dir( subdir))if filex.endswith(extension)]

    def gen_dir_config(self):
        [self.dir_config.append({f'{self.pbs_cwd}/bots/{x}':self.botsubdirs}) for x in self.identify_files(subdir = "bots",extension='_bot.py',replacer='bot')]
        

        return self.dir_config
    def main(self):
        x= self.create_sub_dirs('sleepy2', ['go','night'])
        print(x)


if __name__ == "__main__":
    pbs = PointBotSetup()
    pbs.main()
    path = os.getcwd()
    print(path)



        dirconfig=[

        ],