from cryptography.fernet import Fernet

import os


class PointBotEncryption:
    def __init__(self, pbs, key_full_path=None, keyfilename=None,point_bot_user=None,timestr=None):
        self.pbs = pbs
        if point_bot_user == None:
            self.point_bot_user = pbs.point_bot_user 
        else: 
            self.point_bot_user = point_bot_user

        if key_full_path == None:
            self.key_full_path = pbs.encryptionkeypath 
        else: 
            self.key_full_path = key_full_path

        if timestr == None:
            self.timestr = pbs.timestr 
        else: 
            self.timestr = timestr

        if keyfilename == None:
            self.keyfilename = self.point_bot_user+self.timestr
        else:
            self.keyfilename = keyfilename
            
        self.keyfilename = self.key_full_path+self.keyfilename+'pointbotencryptionkey.txt'

        self.fkey = None
        self.load_key()

    def create_key(self):
        encryption_key = Fernet.generate_key()
        self.fkey = Fernet(encryption_key)
        print('creating: ',self.keyfilename)
        self.pbs.pbsavefile(self.keyfilename, encryption_key,writetype="wb")

    def load_key(self):

        try:
            self.fkey = Fernet(self.pbs.pbloadfile(self.keyfilename, "rb"))

        except Exception as e:
            print(e)
            return self.create_key()


    def encrypt_string(self, input_string):
        if self.fkey == None:
            self.load_key()

        encoded_string = input_string.encode()
        return self.fkey.encrypt(encoded_string)

    def decrypt_string(self, encrypted_string):
        try:
            if self.fkey == None:
                self.load_key()
            return self.fkey.decrypt(encrypted_string).decode()
        except Exception as e:
            print(e)
            print('decryption_error')
            

    def encrypt_file(self, input_file, remove_input=True):
        if self.fkey == None:
            self.load_key()
        pre, ext = os.path.splitext(input_file)
        output_file = f"{pre}{ext.replace('.','__')}.encrypted"

        data = self.pbs.pbloadfile(input_file, "rb")
        encrypted = self.fkey.encrypt(data)

        self.pbs.pbsavefile(self.keyfilename, encrypted,writetype="wb")

        if remove_input == True:
            os.remove(input_file)
        else:
            print(f"CATION {input_file} WAS NOT DELETED")

        print(f"Encrypted: {input_file} --> {output_file}")

    def decrypt_file(self, input_file, remove_input=True):
        if self.fkey == None:
            self.load_key()
        pre, ext = os.path.splitext(input_file)

        output_file = pre.replace("__", ".")
        data = self.pbs.pbloadfile(input_file, "rb")

        decrypted = self.fkey.decrypt(data)

        self.pbs.pbsavefile(self.keyfilename, decrypted,writetype="wb")

        if remove_input == True:
            os.remove(input_file)
        else:
            print(f"CATION {input_file} WAS NOT DELETED")
        print(f"Decrypted: {input_file} --> {output_file}")



if __name__ == "__main__":
    from setup_point_bot import PointBotSetup
    pbs = PointBotSetup(headless = False,offlinemode=0,point_bot_user='jkail')
    pbs.start()
    # pbe = PointBotEncryption().create_key()
    pbe = PointBotEncryption(pbs)
    # print(pbe.encrypt_string('test'))
    ##print(pbe.decrypt_string(pbe.encrypt_string('test')))
    # pbe.encrypt_file("aaa.txt")
    # pbe.decrypt_file("aaa__txt.encrypted")
