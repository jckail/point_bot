from cryptography.fernet import Fernet
import os


class PointBotEncryption:
    def __init__(self, pbs, key_full_path=None, keyfilename=None,point_bot_user=None):
        print(pbs.point_bot_user )
        if point_bot_user == None:
            self.point_bot_user = pbs.point_bot_user 
        else: 
            self.point_bot_user = point_bot_user
        if key_full_path == None:
            self.key_full_path = pbs.encryptionkeypath 
        else: 
            self.key_full_path = key_full_path
        if keyfilename == None:
            self.keyfilename = self.point_bot_user+pbs.timestr+'pointbotencryptionkey.txt'
        else:
            self.keyfilename = keyfilename+'pointbotencryptionkey.txt'
            
        self.keyfilename = self.key_full_path+self.keyfilename
        self.fkey = None
        self.load_key()

    def create_key(self):
        encryption_key = Fernet.generate_key()
        self.fkey = Fernet(encryption_key)
        file = open(self.keyfilename, "wb")
        print('saving:  ',self.keyfilename)
        file.write(encryption_key)  # The key is type bytes still
        file.close()

    def load_key(self):

        try:
            file = open(self.keyfilename, "rb")
            encryption_key = file.read()  # The key will be type bytes
            file.close()
            self.fkey = Fernet(encryption_key)

        except Exception as e:
            print(e)
            return self.create_key()


    def encrypt_string(self, input_string):
        if self.fkey == None:
            self.load_key()

        encoded_string = input_string.encode()
        return self.fkey.encrypt(encoded_string)

    def decrypt_string(self, encrypted_string):
        if self.fkey == None:
            self.load_key()
        return self.fkey.decrypt(encrypted_string).decode()

    def encrypt_file(self, input_file, remove_input=True):
        if self.fkey == None:
            self.load_key()
        pre, ext = os.path.splitext(input_file)
        output_file = f"{pre}{ext.replace('.','__')}.encrypted"
        with open(input_file, "rb") as f:
            data = f.read()
        encrypted = self.fkey.encrypt(data)

        with open(output_file, "wb") as f:
            f.write(encrypted)

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
        with open(input_file, "rb") as f:
            data = f.read()

        decrypted = self.fkey.decrypt(data)
        with open(output_file, "wb") as f:
            f.write(decrypted)
        if remove_input == True:
            os.remove(input_file)
        else:
            print(f"CATION {input_file} WAS NOT DELETED")
        print(f"Decrypted: {input_file} --> {output_file}")

    # def decrypt_obj(self,decrypt_obj):
    #     f = Fernet(self.encryption_key)
    #     encrypted = f.decrypt(message)


if __name__ == "__main__":
    # pbe = PointBotEncryption().create_key()
    pbe = PointBotEncryption()
    # pbe.load_key()
    # print(pbe.encrypt_string('test'))
    ##print(pbe.decrypt_string(pbe.encrypt_string('test')))
    pbe.encrypt_file("aaa.txt")
    pbe.decrypt_file("aaa__txt.encrypted")
