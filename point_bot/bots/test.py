import os
import sys


print(f""" \n
sys.platform: {sys.platform}
sysname: {os.uname().sysname}
version: {os.uname().version}
release: {os.uname().release}
machine: {os.uname().machine}
\n
""")

import undetected_chromedriver as uc
uc.install() #important this is first
from selenium.webdriver import Chrome, ChromeOptions
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup

from time import sleep



class BotDriver:
    def __init__(self,username, pw, start_url, url_behind_login, headless_input = True):
        self.username = username
        self.pw = pw
        chrome_options = ChromeOptions()
        chrome_options.headless = headless_input
        chrome_options.add_argument("--incognito")
        chrome_options.add_argument('--disable-extensions')
        chrome_options.add_argument("--start-maximized")

        self.driver = Chrome(chrome_options=chrome_options)
        
        self.start_url = start_url
        self.url_behind_login = url_behind_login
        self.driver.get('https://www.iplocation.net/')
        self.driver.get_screenshot_as_file(f"iplocation.png")
        S = lambda X: self.driver.execute_script('return document.body.parentNode.scroll'+X)
        self.driver.set_window_size(S('Width'),S('Height')) # May need manual adjustment                                                                                                                
        self.driver.find_element_by_tag_name('body').screenshot('web_screenshot.png')
        self.driver.get(start_url)
        self.waitdriver =  WebDriverWait( self.driver, 10)

    def get_element(self,findby,argument_to_click):
        element = self.waitdriver.until(EC.element_to_be_clickable((findby, argument_to_click))) 

        return element
    def slow_keys(self,input_keys,element,speed=.2):
        for character in input_keys:
            sleep(speed)
            element.send_keys(character)
        sleep(1)
    def main(self):
        element0 = self.get_element( By.LINK_TEXT,"Sign In or Join" )
        element0.click()
        element1 = self.get_element( By.XPATH,'//*[@id="user-id"]' )
        element1.click()
        self.slow_keys(self.username,element1)
        element2 = self.get_element( By.XPATH,'//*[@id="password"]' )
        element2.click()
        self.slow_keys(self.pw,element2)
        self.driver.get_screenshot_as_file(f"before_submit.png")
        element3 = self.get_element( By.XPATH,"//button[@name='submitButton']" )
        element3.click()
        self.driver.get_screenshot_as_file(f"after_submit.png")
        sleep(3)
        #test string to find
        soup = BeautifulSoup(self.driver.page_source, 'lxml')
        test = soup.body.findAll(text='My Trips')
        if len(test) > 1:
            print(f'\n\n\n Login Success ({test} len {len(test)})\n\n\n')
        else:
            print(f'\n\n\n Login failed ({test} len {len(test)})\n\n\n')
        self.driver.get(self.url_behind_login)
        self.driver.get_screenshot_as_file(f"last.png")

if __name__ == "__main__":
    username = 'whitehat98388@gmail.com'
    #username = input('Enter your login email: ')
    pw = 'Test2020'
    #pw = input('Enter your password: ')
    start_url = 'https://www.marriott.com/default.mi'
    url_behind_login = 'https://www.marriott.com/loyalty/findReservationList.mi'
    pbd = BotDriver(username, pw, start_url, url_behind_login, headless_input = True)
    pbd.main()
