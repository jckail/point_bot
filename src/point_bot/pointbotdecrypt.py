from cryptography.fernet import Fernet

from cryptography.fernet import Fernet


point_bot_user = 'jkail'
decryptionkey = '20200610122032'
storedpw = "gAAAAABe4SSRRb6euQwnm-VHmJhigLZxRcgtmUPPOs-6UhPfZVj6Kjjhx48JsmGNiy_VZQgNYp4rzaVtAMC-7fWjUz4i36RT4A=="

    # def decrypt(self,stringtodecrypt):
    #     pbe2 = PointBotEncryption(self.pbs,keyfilename=self.decryptionkey)
    #     pbe2.load_key()
    #     print(pbe2.decrypt_string("gAAAAABe4SSRRb6euQwnm-VHmJhigLZxRcgtmUPPOs-6UhPfZVj6Kjjhx48JsmGNiy_VZQgNYp4rzaVtAMC-7fWjUz4i36RT4A==".encode()))
    #     return pbe2.decrypt_string(stringtodecrypt.encode())

from getpass import getpass
password = getpass()
print(password)