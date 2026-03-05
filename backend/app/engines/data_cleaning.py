"""数据清洗引擎，支持10种数据处理算子。"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Tuple
import pandas as pd
import re
from datetime import datetime


class DataOperator(ABC):
    """数据处理算子基类"""

    @abstractmethod
    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        """应用清洗操作"""
        pass

    @abstractmethod
    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """返回验证失败的记录"""
        pass


class RemoveNullsOperator(DataOperator):
    """去除空值行"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns")
        if columns:
            return df.dropna(subset=columns)
        return df.dropna()

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        columns = params.get("columns")
        if columns:
            mask = df[columns].isnull().any(axis=1)
        else:
            mask = df.isnull().any(axis=1)
        failed = df[mask]
        return [{"row_index": idx, "data": row.to_dict(), "error": "Contains null values"}
                for idx, row in failed.iterrows()]


class RemoveDuplicatesOperator(DataOperator):
    """去除重复数据"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        subset = params.get("columns")
        keep = params.get("keep", "first")
        return df.drop_duplicates(subset=subset, keep=keep)

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        subset = params.get("columns")
        duplicated = df[df.duplicated(subset=subset, keep=False)]
        return [{"row_index": idx, "data": row.to_dict(), "error": "Duplicate record"}
                for idx, row in duplicated.iterrows()]


class FillMissingOperator(DataOperator):
    """填充缺失值"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        method = params.get("method", "constant")
        value = params.get("value", "")
        columns = params.get("columns")

        if method == "constant":
            if columns:
                df[columns] = df[columns].fillna(value)
            else:
                df = df.fillna(value)
        elif method == "forward":
            if columns:
                df[columns] = df[columns].fillna(method='ffill')
            else:
                df = df.fillna(method='ffill')
        elif method == "backward":
            if columns:
                df[columns] = df[columns].fillna(method='bfill')
            else:
                df = df.fillna(method='bfill')
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        # No validation failures - fills missing values
        return []


class TrimWhitespaceOperator(DataOperator):
    """Trim前后空格"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", df.select_dtypes(include=['object']).columns)
        for col in columns:
            if col in df.columns and df[col].dtype == 'object':
                df[col] = df[col].str.strip()
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        # No validation failures - trims whitespace
        return []


class NormalizeCaseOperator(DataOperator):
    """统一大小写"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        case = params.get("case", "lower")  # lower, upper, title
        columns = params.get("columns", df.select_dtypes(include=['object']).columns)

        for col in columns:
            if col in df.columns and df[col].dtype == 'object':
                if case == "lower":
                    df[col] = df[col].str.lower()
                elif case == "upper":
                    df[col] = df[col].str.upper()
                elif case == "title":
                    df[col] = df[col].str.title()
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        # No validation failures - normalizes case
        return []


class StandardizeDateOperator(DataOperator):
    """日期格式标准化"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", [])
        format = params.get("format", "%Y-%m-%d")

        for col in columns:
            if col in df.columns:
                try:
                    df[col] = pd.to_datetime(df[col]).dt.strftime(format)
                except:
                    pass  # Skip if conversion fails
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        columns = params.get("columns", [])
        failed = []

        for col in columns:
            if col in df.columns:
                for idx, val in df[col].items():
                    try:
                        pd.to_datetime(val)
                    except:
                        failed.append({
                            "row_index": idx,
                            "data": df.loc[idx].to_dict(),
                            "error": f"Invalid date format in column {col}: {val}"
                        })
        return failed


class ValidateEmailOperator(DataOperator):
    """邮箱格式校验"""

    EMAIL_PATTERN = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", [])
        remove_invalid = params.get("remove_invalid", False)

        if remove_invalid:
            for col in columns:
                if col in df.columns:
                    df = df[df[col].astype(str).str.match(self.EMAIL_PATTERN, na=False)]
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        columns = params.get("columns", [])
        failed = []

        for col in columns:
            if col in df.columns:
                for idx, val in df[col].items():
                    if pd.notna(val) and not self.EMAIL_PATTERN.match(str(val)):
                        failed.append({
                            "row_index": idx,
                            "data": df.loc[idx].to_dict(),
                            "error": f"Invalid email format in column {col}: {val}"
                        })
        return failed


class ValidatePhoneOperator(DataOperator):
    """电话号码格式校验"""

    # 简单的中国手机号验证
    PHONE_PATTERN = re.compile(r'^1[3-9]\d{9}$')

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", [])
        remove_invalid = params.get("remove_invalid", False)

        if remove_invalid:
            for col in columns:
                if col in df.columns:
                    # Remove non-digits first
                    df[col] = df[col].astype(str).str.replace(r'\D', '', regex=True)
                    df = df[df[col].str.match(self.PHONE_PATTERN, na=False)]
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        columns = params.get("columns", [])
        failed = []

        for col in columns:
            if col in df.columns:
                for idx, val in df[col].items():
                    if pd.notna(val):
                        clean_val = re.sub(r'\D', '', str(val))
                        if not self.PHONE_PATTERN.match(clean_val):
                            failed.append({
                                "row_index": idx,
                                "data": df.loc[idx].to_dict(),
                                "error": f"Invalid phone format in column {col}: {val}"
                            })
        return failed


class DetectOutliersOperator(DataOperator):
    """异常值检测"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", [])
        method = params.get("method", "iqr")  # iqr or zscore
        remove_outliers = params.get("remove_outliers", False)

        if not remove_outliers:
            return df

        mask = pd.Series([True] * len(df), index=df.index)

        for col in columns:
            if col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
                if method == "iqr":
                    Q1 = df[col].quantile(0.25)
                    Q3 = df[col].quantile(0.75)
                    IQR = Q3 - Q1
                    lower = Q1 - 1.5 * IQR
                    upper = Q3 + 1.5 * IQR
                    mask &= (df[col] >= lower) & (df[col] <= upper)
                elif method == "zscore":
                    mean = df[col].mean()
                    std = df[col].std()
                    zscore = (df[col] - mean) / std
                    mask &= (zscore.abs() <= 3)

        return df[mask]

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        columns = params.get("columns", [])
        method = params.get("method", "iqr")
        failed = []

        for col in columns:
            if col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
                if method == "iqr":
                    Q1 = df[col].quantile(0.25)
                    Q3 = df[col].quantile(0.75)
                    IQR = Q3 - Q1
                    lower = Q1 - 1.5 * IQR
                    upper = Q3 + 1.5 * IQR
                    outliers = df[(df[col] < lower) | (df[col] > upper)]
                elif method == "zscore":
                    mean = df[col].mean()
                    std = df[col].std()
                    zscore = (df[col] - mean) / std
                    outliers = df[zscore.abs() > 3]

                for idx, row in outliers.iterrows():
                    failed.append({
                        "row_index": idx,
                        "data": row.to_dict(),
                        "error": f"Outlier detected in column {col}: {row[col]}"
                    })

        return failed


class MaskSensitiveOperator(DataOperator):
    """数据脱敏"""

    def apply(self, df: pd.DataFrame, params: Dict[str, Any]) -> pd.DataFrame:
        columns = params.get("columns", [])
        mask_type = params.get("mask_type", "partial")  # partial, full, hash

        for col in columns:
            if col in df.columns:
                if mask_type == "full":
                    df[col] = "***"
                elif mask_type == "partial":
                    # Keep first and last char, mask middle
                    df[col] = df[col].astype(str).apply(
                        lambda x: x[0] + '*' * (len(x) - 2) + x[-1] if len(x) > 2 else '*' * len(x)
                    )
                elif mask_type == "hash":
                    import hashlib
                    df[col] = df[col].astype(str).apply(
                        lambda x: hashlib.md5(x.encode()).hexdigest()[:8]
                    )
        return df

    def validate(self, df: pd.DataFrame, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        # No validation failures - masks data
        return []


class DataCleaningEngine:
    """数据清洗引擎，支持算子链式调用"""

    OPERATORS = {
        "remove_nulls": RemoveNullsOperator(),
        "remove_duplicates": RemoveDuplicatesOperator(),
        "fill_missing": FillMissingOperator(),
        "trim_whitespace": TrimWhitespaceOperator(),
        "normalize_case": NormalizeCaseOperator(),
        "standardize_date": StandardizeDateOperator(),
        "validate_email": ValidateEmailOperator(),
        "validate_phone": ValidatePhoneOperator(),
        "detect_outliers": DetectOutliersOperator(),
        "mask_sensitive": MaskSensitiveOperator(),
    }

    def clean(
        self,
        df: pd.DataFrame,
        config: Dict[str, Any]
    ) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        """
        应用清洗配置并返回清洗后的数据和失败记录

        Args:
            df: 原始数据
            config: {"operators": [{"name": "remove_nulls"}, {"name": "fill_missing", "params": {...}}]}

        Returns:
            (cleaned_df, failed_records)
        """
        operators = config.get("operators", [])
        failed_records = []
        cleaned_df = df.copy()

        for op_config in operators:
            op_name = op_config.get("name")
            op_params = op_config.get("params", {})

            if op_name not in self.OPERATORS:
                continue

            operator = self.OPERATORS[op_name]

            # Collect validation failures before applying
            failures = operator.validate(cleaned_df, op_params)
            failed_records.extend(failures)

            # Apply the operator
            try:
                cleaned_df = operator.apply(cleaned_df, op_params)
            except Exception as e:
                # Log error but continue
                import logging
                logging.error(f"Error applying operator {op_name}: {e}")

        return cleaned_df, failed_records
