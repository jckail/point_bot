# assault

A simple CLI load testing tool.

## Installation

Install using `pip3.7 install point_bot/dist/point_bot-1.0.0-py3-none-any.whl`:

```
$ pip install assault
```

## Usage

The simplest usage of `assault` requires only a URL to test against and 500 requests synchronously (one at a time). This is what it would look like:

```
$ assault https://example.com
.... Done!
--- Results ---
[   sortable column  DATE sortable column  CATEGORY                       sortable column  DESCRIPTION             sortable column  POINTS
0            Jun 3, 2020               Credit Card               Rapid Rewards Credit Card 06/02/2020         plus 730 points  + 730  PTS
1           May 14, 2020                    Flight  REDEEM - LKEU6D - Las Vegas, NV - LAS to Denve...    minus 9,039 points  - 9,039  PTS
2           May 14, 2020                    Flight  REDEEM - LJ7SH3 - Denver, CO - DEN to Las Vega...    minus 9,039 points  - 9,039  PTS
3            May 2, 2020               Credit Card               Rapid Rewards Credit Card 05/01/2020         plus 477 points  + 477  PTS
4            Apr 3, 2020               Credit Card               Rapid Rewards Credit Card 04/02/2020         plus 710 points  + 710  PTS
5           Mar 30, 2020                    Flight  REDEEM - TZHI2X - Denver, CO - DEN to Belize C...  minus 28,080 points  - 28,080  PTS
6           Mar 30, 2020                    Flight                                    REFUND - TZHI2X   plus 28,080 points  + 28,080  PTS
7           Mar 30, 2020                    Flight  REDEEM - KXDDHX - Denver, CO - DEN to Cancun, ...  minus 17,394 points  - 17,394  PTS
8            Mar 9, 2020                    Flight  QXCMXJ - Salt Lake City, UT - SLC to Denver, C...     plus 5,226 points  + 5,226  PTS
9            Mar 7, 2020                    Flight  REDEEM - TXGYBP - Denver, CO - DEN to Salt Lak...  minus 19,923 points  - 19,923  PTS
10           Mar 7, 2020                    Flight  REDEEM - TXU3H3 - Salt Lake City, UT - SLC to ...  minus 10,304 points  - 10,304  PTS
11           Mar 7, 2020                    Flight                                    REFUND - TXU3H3   plus 10,304 points  + 10,304  PTS
12           Mar 3, 2020               Credit Card               Rapid Rewards Credit Card 03/02/2020         plus 723 points  + 723  PTS
13           Mar 1, 2020                    Flight  Q8L7PF - Denver, CO - DEN to Seattle/Tacoma, W...     plus 7,566 points  + 7,566  PTS
14           Mar 1, 2020                    Flight  REDEEM - SV9F2P - Salt Lake City, UT - SLC to ...  minus 19,923 points  - 19,923  PTS
15           Mar 1, 2020                    Flight                                    REFUND - SV9F2P   plus 19,923 points  + 19,923  PTS
16           Mar 1, 2020                    Flight  REDEEM - SV7ZMR - Denver, CO - DEN to Salt Lak...    minus 8,272 points  - 8,272  PTS
17           Mar 1, 2020                    Flight                                    REFUND - SV7ZMR     plus 8,272 points  + 8,272  PTS
18          Feb 27, 2020                    Flight  W7ZH55 - Denver, CO - DEN to Seattle/Tacoma, W...   plus 15,696 points  + 15,696  PTS
19          Feb 20, 2020                    Flight  W8MH9F - Denver, CO - DEN to Seattle/Tacoma, W...   plus 15,696 points  + 15,696  PTS]
```

If we want to add concurrency, we'll use the `-c` option, and we can use the `-r` option to specify how many requests that we'd like to make:

```
$ assault -r 3000 -c 10 https://example.com
.... Done!
--- Results ---
Successful requests     3000
Slowest                 0.010s
Fastest                 0.001s
Average                 0.003s
Total time              2.400s
Requests Per Minute     90000
Requests Per Second     1250
```

If you'd like to see these results in JSON format, you can use the `-j` option with a path to a JSON file:

```
$ assault -r 3000 -c 10 -j output.json https://example.com
.... Done!
```

## Development

For working on `assult`, you'll need to have Python >= 3.7 (because we'll use `asyncio`) and [`pipenv`][1] installed. With those installed, run the following command to create a virtualenv for the project and fetch the dependencies:

```
$ pipenv install --dev
...
```

Next, activate the virtualenv and get to work:

```
$ pipenv shell
...
(assault) $
```

[1]: https://docs.pipenv.org/en/latest/
