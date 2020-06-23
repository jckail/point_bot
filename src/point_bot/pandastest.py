import pandas as pd
from bs4 import BeautifulSoup




if __name__ == '__main__':
    soup = open('jkail_SouthwestBot_mine_southwest_points_step6_hl_after.html','r+').read()
    soup = BeautifulSoup(soup, 'lxml')
   
    my_list = soup.find_all(
            "span", class_="pagination--total-pages",
        )
    my_list = [x.text for x in my_list][0]
    print(my_list)