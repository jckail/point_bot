from time import sleep
import undetected_chromedriver as uc
from selenium.webdriver import ActionChains
from selenium.webdriver.common.touch_actions import TouchActions
import random
# from selenium.webdriver.common.keys import Keys
# uc.TARGET_VERSION = 83  #this is what was fucking u
# uc.install() #important this is first

from selenium.webdriver.chrome.options import Options

mobile_emulation = {

    "deviceMetrics": { "width": 360, "height": 640, "pixelRatio": 3.0 },

    "userAgent": "Mozilla/5.0 (Linux; Android 4.2.1; en-us; Nexus 5 Build/JOP40D) AppleWebKit/535.19 (KHTML, like Gecko) Chrome/18.0.1025.166 Mobile Safari/535.19" }

chrome_options = Options()
chrome_options.add_experimental_option('w3c', False)
# chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
# chrome_options.add_experimental_option('useAutomationExtension', False)
chrome_options.add_experimental_option("mobileEmulation", mobile_emulation)
# chrome_options.add_argument('--disable-extensions')          
driver = uc.Chrome(chrome_options = chrome_options)
aaurl = 'https://www.aa.com/'
aa2 = "https://www.aa.com/loyalty/login?uri=/loyalty/login&previousPage=%2Floyalty%2Fprofile%2Fsummary&continueUrl=%2Floyalty%2Fprofile%2Fsummary"
otherurl = 'https://httpbin.org/headers'
driver.get(aaurl)
#driver.execute_script('return navigator.webdriver')

# actionx = ActionChains(driver).move_to_element(element)#.click()
# sleep(2)
# actionx.perform()
# sleep(1)
# actionx.click().perform()


def write_to_element(driver, element_xpath, input_string):
        js_command = f'document.evaluate(\'{element_xpath}\', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.value = \'{input_string}\';'
        driver.execute_script(js_command)

# driver = webdriver.Chrome()
# driver.get('WebPage/With/Element/You/Want/To/Write/To')
# xpath = 'Xpath/Of/Element/You/Want/To/Write/To'
# write_to_element(driver, xpath, 'SomeRandomInput')


def sleep_keys(element,input_keys):
    for character in str(input_keys):
        sleep(random.uniform(1.5, 2.1))
        element.send_keys(character)

def movetoandclick(driver, el_id, click= None, characters = None):
    # driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
    #     "source": """
    #         Object.defineProperty(navigator, 'webdriver', {
    #         get: () => undefined
    #         })
    #     """
    #     })
    #sleep(3)

#//*[@id="loginId"]
#/html/body/main/div/form/section[1]/div/div[1]/label/input
    if click:
        action = ActionChains(driver)

        x = driver.find_element_by_id(el_id)
        action.move_to_element(x).perform()

        sleep(random.uniform(1.3, 1.5))
        x2 = driver.find_element_by_id(el_id)
        action.move_to_element(x2).click().perform()

    if characters:
        sleep(random.uniform(0.2, 1.1))
        element = driver.find_element_by_id(el_id)
        sleep_keys(element,characters)

sleep(5)

#ovetoandclick(driver, 'loginLogoutLink-phone', click = True, characters = None)
print('QUICK CLICK BOX!')
#sleep(10)
#rememberMe
#movetoandclick(driver, 'rememberMe', click = True, characters = None)
# element = driver.find_element_by_id('loginId')
# sleep_keys(element,characters)
# print('go')
characters = "1RD0F76"
#movetoandclick(driver, 'loginId', characters = characters)
#element = driver.find_element_by_id('loginId')
touchactions = TouchActions(driver)
element = driver.find_element_by_id('loginLogoutLink-phone')
touchactions.tap(element).perform()
sleep(3)
print('go!')
touchactions = TouchActions(driver)
touchactions.scroll(0,40).perform()
sleep(2)
touchactions = TouchActions(driver)
touchactions.move(10,30).perform()
sleep(2)
touchactions = TouchActions(driver)
touchactions.scroll(0,-20).perform()
# element = driver.find_element_by_xpath('//*[@id="loginFormId"]/section[1]/div/div[4]/div/label/span')
# touchactions.tap(element).perform()
# #sleep_keys(element,characters)

# #write_to_element(driver, '//*[@id="loginId"]', characters)

# sleep(3)
# characters = "Kail"
# # element = driver.find_element_by_id('lastName')
# # sleep_keys(element,characters)
# movetoandclick(driver, 'lastName', characters = characters)
# sleep(1)
# characters = "Zun!2020"
# # element = driver.find_element_by_id('password')
# # sleep_keys(element,characters)
# movetoandclick(driver, 'password', characters = characters)
# sleep(3)

#element = driver.find_element_by_id('password').send_keys(Keys.ENTER)
#driver.find_element_by_xpath('//*[@id="button_login"]').click()


sleep(30)
if input('close?') == 1:
    driver.quit()