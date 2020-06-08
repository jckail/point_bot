from cryptography.fernet import Fernet
import os


class PointBotEncryption:
    def __init__(self, key_path=os.getcwd(), key_file_name="pointbot"):
        self.key_path = key_path
        self.key_file_name = key_file_name+ "encryptionkey.txt"
        self.key_full_path = self.key_path + self.key_file_name
        self.fkey = None

    def create_key(self):
        key = Fernet.generate_key()
        file = open(self.key_full_path, "wb")
        file.write(key)  # The key is type bytes still
        file.close()

    def load_key(self):
        file = open(self.key_full_path, "rb")
        encryption_key = file.read()  # The key will be type bytes
        file.close()
        self.fkey = Fernet(encryption_key)

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
