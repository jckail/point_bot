# from selenium import webdriver
# from selenium.webdriver.chrome.options import Options
# # # import undetected_chromedriver as uc
# # # uc.install() #important this is first
# # driver = webdriver.Chrome()
# # driver.get('https://www.google.com/')

# # from undetected_chromedriver import Chrome, ChromeOptions
# # chrome_options = Options()
# # chrome_options.add_argument("--remote-debugging-port=9222")



# #driver = Chrome(chrome_options=chrome_options)\

# driver = webdriver.Chrome('/Users/jckail13/pointly/point_bot/point_bot/chromedriver')
# driver.get('https://distilnetworks.com')

from selenium import webdriver

driver = webdriver.Chrome('/Users/jckail13/pointly/point_bot/point_bot/chromedriver')
driver.get('https://distilnetworks.com')