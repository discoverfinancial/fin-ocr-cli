# FIN OCR CLI

This project contains a CLI for performing OCR (Optical Character Recognition) using the SDK at [fin-ocr-sdk](https://github.com/discoverfinancial/fin-ocr-sdk).

This CLI supports the following for bank checks:
* debugging, testing, and measuring the accuracy of the SDK at [fin-ocr-sdk](https://github.com/discoverfinancial/fin-ocr-sdk);
* bundling new binary files to be included in the SDK.

NOTE: This CLI is designed to be extended easily to support other use cases in the future.

## How to install the CLI

### Prerequisites

Ensure you have the following installed on your system:

- Git
- [Node.js](https://nodejs.org/) (v20.x or higher, which includes npm)
- npm (comes with Node.js)

### Installation Steps

#### 1. Clone the SDK and CLI Repositories
Clone both the SDK and CLI repositories:

```bash
git clone https://github.com/discoverfinancial/fin-ocr-sdk.git
git clone https://github.com/discoverfinancial/fin-ocr-cli.git
```

#### 2. Build and Link the SDK
Navigate to the SDK directory, install dependencies, build it, and `link` it globally:

```bash
cd fin-ocr-sdk
npm run build
npm link
```

#### 3. Install Dependencies and Link the CLI
Navigate to the CLI directory, install dependencies, link the SDK and build the project:

```bash
cd ../fin-ocr-cli
npm link @discoverfinancial/fin-ocr-sdk
npm run build
```

#### 4. Running the CLI
Once the build is complete, you can use the CLI by running the following command:

```sh
./scripts/ocr
```
This command directly invokes the ocr script located in the scripts directory of the project.

### Local vs Global Installation

#### Local Installation
To run the CLI locally, you simply execute the command directly from the project directory as shown above (./scripts/ocr).
This method does not add the CLI to your system's global PATH, so the ocr command will only be available when run from within the fin-ocr-cli directory.

#### Global Installation
To make the ocr command available "globally" on your system, you can install the CLI using the following command from within the fin-ocr-cli directory:

```bash
npm install -g .
```

After global installation, you can run the ocr command from any directory on your system without needing to specify the script path.
This is convenient if you need to use the CLI across multiple projects or from anywhere on your system.

## How to use the CLI

You should now be able to execute the `ocr` command as follows:

```bash
$ ocr
Usage: ocr check scan <path-to-check-image>
           check test <checkNum> [<numChecks>]
           check debug <comma-separated-list-of-check-nums>
           check preprocess <output-dir> <checkNum> [<numChecks>]
           buildFiles [<dir>]
```

This section describes how to use the CLI to perform various tasks as follows:
* [How to scan a single check image from a local file](#how-to-scan-a-single-check-image)
* [How to prepare check data for scanning multiple images from an X9 file](#how-to-prepare-check-data)
* [How to measure OCR accuracy](#how-to-measure-ocr-accuracy)
* [How to debug check mismatches](#how-to-debug-mismatches)
* [How to use the CLI as a client for the REST service](#how-to-use-the-cli-as-a-client-for-the-rest-service)

### How to scan a single check image

Run the following command to perform OCR on a check image that is stored in a local file:

```
ocr check scan <path-to-image-file>
```

The output produced by this command is similar to the following:

```
{
    "id": "check-1.tif",
    "translators": {
        "tesseract": {
            "result": {
                "micrLine": "U1234567UT123456789T1234567890U12345678\n",
                "routingNumber": "123456789",
                "accountNumber": "1234567890",
                "checkNumber": "1234567"
            }
        },
        "opencv": {
            "result": {
                "micrLine": "U1234567UT123456789T1234567890U12345678",
                "routingNumber": "123456789",
                "accountNumber": "1234567890",
                "checkNumber": "1234567"
            }
        }
    },
    "overlap": false
}
```

There are two translators: tesseract and opencv.  Each translator returns results including the routing, account, and check numbers.
The entire translated MICR line is also returned for each translator.

In order to use only a single translator, you may set the `OCR_TRANSLATORS` environment variable as follows:
* to use only the tesseract translator, `OCR_TRANSLATORS=tesseract`;

* to use only the opencv translator, `OCR_TRANSLATORS=opencv`.

The default setting is `OCR_TRANSLATORS=tesseract,opencv`.

### How to prepare check data

The `ocr` commands described below, `ocr check test` and `ocr check debug`, support processing of a large number of checks images.  This section describes the format of the check data expected by these commands and how to prepare this data.

For each check, there must be two files with the same file prefix but different suffixes: a TIFF file and a JSON file.  The TIFF file contains the check image in TIFF format and the JSON file contains the following fields:

```
{
  "auxiliaryOnUs": "1234567",
  "payorBankRoutingNumber": "12345678",
  "payorBankCheckDigit": "1",
  "onUs": "1234567890/"
}
```

For example, `check-1.tiff` contains the TIFF image for check number 1 while `check-1.json` contains what is known as the *ground truth* for what is on the image.

Preparing this data manually can be very time consuming.  If you have one or more X9 files, see the [x9-extract tool](https://github.com/discoverfinancial/fin-ocr-train/tree/main/x9-extract) for how to prepare this check data automatically.

### How to measure OCR accuracy

This section assumes that you have prepared the check data over which you will measure the OCR accuracy.  The default location for this check data is `$HOME/.fin-ocr/checks` but can be set explicitly via `CHECKS_DIR` environment variable.

The following command measures the accuracy:

```
ocr check test START COUNT
```

where START is the starting check number and COUNT is the number of checks.

For example, the following measures the accuracy over checks 1 through 100.

```
ocr check test 1 100
```

The output is similar to the following (minus the line numbers )
```
1) 2024-07-29T13:44:57.186Z inf ocr-sdk Initializing tesseract: {"font":"micr_e13b","pageSegmentationMode":"13"}
2) 2024-07-29T13:44:57.215Z inf ocr-sdk Added tesseract MICR translator
2024-07-29T13:44:57.215Z inf ocr-sdk Initializing tesseract: {"font":"eng","pageSegmentationMode":"3"}
3) 2024-07-29T13:44:57.245Z inf ocr-sdk Added tesseract full page translator
4) 2024-07-29T13:44:57.245Z inf ocr-sdk Added opencv translator
5) 2024-07-29T13:45:02.722Z inf cli Check 1: match=true (100.00%)
...
6) 2024-07-29T13:45:15.778Z inf cli Mismatches: [23,83]
7) 2024-07-29T13:45:15.778Z inf cli Mismatches to evaluate: [83]
8) 2024-07-29T13:45:15.778Z inf cli Matches to reevaluate: []
9) 2024-07-29T13:45:15.778Z inf cli Counts: match=98, x9Wrong=0, total=100
10) 2024-07-29T13:45:15.778Z inf cli Percentage: match=98.00%, x9Wrong=0.00%
11) Execution time: 0 minutes, 21 seconds
```

Note the following in the sample output:
* line 5 - a running percentage is logged after each check which specifies the total accuracy thus far;
* line 6 - checks 23 and 83 mismatched; that is, the results of OCR'ing the tiff image file mismatched the values found in the associated JSON file containing the ground truth;
* line 7 - check 83 mismatched and still needs to be evaluated and categorized with the reason for the mismatch; the [evaluating a mismatching check] for more information.
* line 8 - there are no checks which need to be re-evaluated; a check needs reevaluating if it previously mismatched and was added to the list of mismatching checks with a reason, but now the OCR results match the ground truth;
* line 9 - the number of checks which matched is 98, the number of checks which had the X9 wrong in the JSON was 0, and the total number of checks processed was 100;
* line 10 - the percentage of checks whose OCR results matched the ground truth was 98.00% and the percentage of checks with incorrect OCR results was 0.00%;
* line 11 - the total execution time to OCR these 100 checks was 21 seconds.

##### Correcting invalid values from X9 files

The values in the JSON files which are extracted from X9 files may be inaccurate.  In this case, you may use the CHECK_EVAL_DATA environment variable to correct these values used by the `ocr check` commands.

For example, suppose that the data in the file `$HOME/.fin-ocr/checks/check-10.json` says the check number is 123 but the real check number is 124.  You confirmed this by looking at the check image in file `$HOME/.fin-ocr/checks/check-10.tiff`.  In this case, you can create a file named `check-eval-data.json` in the current directory with the following contents:

```
{
    "mismatchesByReason": {
    },
    "correctX9": {
        "10": "T123456789T123456789012U124"
    }
}
```

The "10" is for check number 10.
The characters representing the MICR symbols in the value is as follows:
* "T" - transit symbol
* "U" - on-us symbol
* "A" - amount symbol
* "D" - dash symbol

In the example above, the routing number occurs between the 2 T's (transit symbols) and is "123456789".  The account number occurs between the 2nd T  (transit symbol) and the U (on-us symbol) and is "123456789012".  The check number is to the right of the U (on-us symbol) and is corrected to be "124" rather than "123".

You may now run the following command to use this file:

```
CHECK_EVAL_DATA=./check-eval-data.json ocr check test 1 100
```

### How to debug mismatches

The `ocr check debug` command is intended for developers and requires more indepth knowledge.  In particular, it is useful for determining the reason for a mismatch.  See the [Developer's Guide](https://github.com/discoverfinancial/fin-ocr/blob/main/DEV_GUIDE.md#fin-ocr-developers-guide) for more information.

### How to use the CLI as a client for the REST service

If you set the `URL` environment variable to point to the REST service endpoint, each of the `ocr check` commands (`ocr check scan`, `ocr check test`, and `ocr check debug`) will send requests remotely to the REST service rather than servicing them locally.

For example, assuming the REST service is running on port 3000 of localhost, the following will measure the accuracy of the REST service for checks 1 through 100:

```
URL=http://localhost:3000 ocr check test 1 100
```

## Appendix

### OCR accuracy table

The following table is being used to track OCR accuracy progress and contains the results of running the `ocr check test 1 20000` command:

|    Date      |     Statistics                           | Number of checks |                      Description of changes                    |
| ------------ | -----------------------------------------| ---------------- | -------------------------------------------------------------- |
| Jul 11, 2024 | matches=97.81%/19561, x9Wrong=1.51%/303  |    20000         | Initial version                                                |
